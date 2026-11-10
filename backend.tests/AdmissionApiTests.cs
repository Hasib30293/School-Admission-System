using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace SchoolAdmission.Tests;

public sealed class AdmissionApiTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient client;
    public AdmissionApiTests(WebApplicationFactory<Program> factory)
    {
        client = factory.WithWebHostBuilder(b => b.UseSetting("ConnectionStrings:Default", Environment.GetEnvironmentVariable("TEST_CONNECTION") ?? "Host=localhost;Database=school_admission;Username=admission;Password=admission")).CreateClient();
    }

    [Fact]
    public async Task CanCreateClassAndReadIt()
    {
        var name = $"Test class {Guid.NewGuid()}";
        var create = await client.PostAsJsonAsync("/classes", new { name, totalSeats = 2 });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var list = await client.GetFromJsonAsync<List<ClassDto>>("/classes");
        Assert.Contains(list!, x => x.Name == name && x.AvailableSeats == 2);
    }

    [Fact]
    public async Task StudentCannotCreateTwoActiveApplicationsForOneClass()
    {
        var classResponse = await client.PostAsJsonAsync("/classes", new { name = $"Unique {Guid.NewGuid()}", totalSeats = 2 });
        var cls = await classResponse.Content.ReadFromJsonAsync<CreateDto>();
        using var first = new HttpRequestMessage(HttpMethod.Post, $"/classes/{cls!.Id}/holds"); first.Headers.Add("X-Student-Id", "20152691234567890");
        using var second = new HttpRequestMessage(HttpMethod.Post, $"/classes/{cls.Id}/holds"); second.Headers.Add("X-Student-Id", "20152691234567890");
        Assert.Equal(HttpStatusCode.Created, (await client.SendAsync(first)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.SendAsync(second)).StatusCode);
    }

    [Fact]
    public async Task ConcurrentRequestsNeverExceedCapacity()
    {
        var classResponse = await client.PostAsJsonAsync("/classes", new { name = $"Concurrent {Guid.NewGuid()}", totalSeats = 3 });
        var cls = await classResponse.Content.ReadFromJsonAsync<CreateDto>();
        var requests = Enumerable.Range(0, 30).Select(i => Task.Run(async () => { using var req = new HttpRequestMessage(HttpMethod.Post, $"/classes/{cls!.Id}/holds"); req.Headers.Add("X-Student-Id", $"201526912345{i:00000}"); return await client.SendAsync(req); }));
        var responses = await Task.WhenAll(requests);
        Assert.Equal(3, responses.Count(x => x.StatusCode == HttpStatusCode.Created));
        Assert.All(responses.Where(x => x.StatusCode != HttpStatusCode.Created), x => Assert.Equal(HttpStatusCode.Conflict, x.StatusCode));
        var result = await client.GetFromJsonAsync<ClassDto>($"/classes/{cls!.Id}");
        Assert.True(result!.HeldSeats + result.ConfirmedSeats <= result.TotalSeats);
    }

    [Fact]
    public async Task PaymentSubmissionWaitsForAdminApprovalAndIsIdempotent()
    {
        var classResponse = await client.PostAsJsonAsync("/classes", new { name = $"Confirm {Guid.NewGuid()}", totalSeats = 2 });
        var cls = await classResponse.Content.ReadFromJsonAsync<CreateDto>();
        using var createHold = new HttpRequestMessage(HttpMethod.Post, $"/classes/{cls!.Id}/holds");
        createHold.Headers.Add("X-Student-Id", "30000000000000001");
        var hold = await (await client.SendAsync(createHold)).Content.ReadFromJsonAsync<HoldDto>();

        using var otherConfirm = new HttpRequestMessage(HttpMethod.Post, $"/holds/{hold!.HoldId}/confirm");
        otherConfirm.Headers.Add("X-Student-Id", "30000000000000002");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(otherConfirm)).StatusCode);

        using var ownConfirm1 = new HttpRequestMessage(HttpMethod.Post, $"/holds/{hold.HoldId}/confirm");
        ownConfirm1.Headers.Add("X-Student-Id", "30000000000000001");
        ownConfirm1.Content = JsonContent.Create(new { paymentMethod = "Banking", transactionId = "TX-300-1" });
        using var ownConfirm2 = new HttpRequestMessage(HttpMethod.Post, $"/holds/{hold.HoldId}/confirm");
        ownConfirm2.Headers.Add("X-Student-Id", "30000000000000001");
        ownConfirm2.Content = JsonContent.Create(new { paymentMethod = "Banking", transactionId = "TX-300-1" });
        var first = await client.SendAsync(ownConfirm1);
        var second = await client.SendAsync(ownConfirm2);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Equal("PENDING", (await first.Content.ReadFromJsonAsync<ConfirmDto>())!.Status);
        Assert.Equal("PENDING", (await second.Content.ReadFromJsonAsync<ConfirmDto>())!.Status);

        // Payment details alone must not confirm the seat: it still counts as held, not confirmed.
        var afterSubmit = await client.GetFromJsonAsync<ClassDto>($"/classes/{cls!.Id}");
        Assert.Equal(1, afterSubmit!.HeldSeats);
        Assert.Equal(0, afterSubmit.ConfirmedSeats);

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"/holds/{hold.HoldId}/approve", null)).StatusCode);

        var after = await client.GetFromJsonAsync<ClassDto>($"/classes/{cls!.Id}");
        Assert.Equal(0, after!.HeldSeats);
        Assert.Equal(1, after.ConfirmedSeats);
    }

    [Fact]
    public async Task PendingPaymentBlocksDuplicatesAndRejectionReleasesTheSeat()
    {
        var classResponse = await client.PostAsJsonAsync("/classes", new { name = $"Review {Guid.NewGuid()}", totalSeats = 1 });
        var cls = await classResponse.Content.ReadFromJsonAsync<CreateDto>();
        using var createHold = new HttpRequestMessage(HttpMethod.Post, $"/classes/{cls!.Id}/holds");
        createHold.Headers.Add("X-Student-Id", "60000000000000001");
        var hold = await (await client.SendAsync(createHold)).Content.ReadFromJsonAsync<HoldDto>();

        using var confirm = new HttpRequestMessage(HttpMethod.Post, $"/holds/{hold!.HoldId}/confirm");
        confirm.Headers.Add("X-Student-Id", "60000000000000001");
        confirm.Content = JsonContent.Create(new { paymentMethod = "Offline", transactionId = "TX-OFF-9" });
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(confirm)).StatusCode);

        using var duplicate = new HttpRequestMessage(HttpMethod.Post, $"/classes/{cls!.Id}/holds");
        duplicate.Headers.Add("X-Student-Id", "60000000000000001");
        Assert.Equal(HttpStatusCode.Conflict, (await client.SendAsync(duplicate)).StatusCode);

        var pending = await client.GetFromJsonAsync<List<StudentDto>>($"/classes/{cls.Id}/holds");
        var pendingStudent = Assert.Single(pending!);
        Assert.Equal("PENDING", pendingStudent.Status);
        Assert.Equal("TX-OFF-9", pendingStudent.TransactionId);

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"/holds/{hold.HoldId}/reject", JsonContent.Create(new { note = "Transaction not found" }))).StatusCode);

        var after = await client.GetFromJsonAsync<ClassDto>($"/classes/{cls.Id}");
        Assert.Equal(0, after!.HeldSeats);
        Assert.Equal(0, after.ConfirmedSeats);
        Assert.Equal(1, after.AvailableSeats);

        using var retry = new HttpRequestMessage(HttpMethod.Post, $"/classes/{cls.Id}/holds");
        retry.Headers.Add("X-Student-Id", "60000000000000002");
        Assert.Equal(HttpStatusCode.Created, (await client.SendAsync(retry)).StatusCode);
    }

    [Fact]
    public async Task ContactNumberMustBeExactlyElevenDigits()
    {
        var classResponse = await client.PostAsJsonAsync("/classes", new { name = $"Contact {Guid.NewGuid()}", totalSeats = 1 });
        var cls = await classResponse.Content.ReadFromJsonAsync<CreateDto>();

        foreach (var bad in new[] { "12345", "0171234567a", "017123456789" })
        {
            using var invalid = new HttpRequestMessage(HttpMethod.Post, $"/classes/{cls!.Id}/holds");
            invalid.Headers.Add("X-Student-Id", "99900000000000001");
            invalid.Content = JsonContent.Create(new { contactInfo = bad });
            Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(invalid)).StatusCode);
        }

        using var valid = new HttpRequestMessage(HttpMethod.Post, $"/classes/{cls!.Id}/holds");
        valid.Headers.Add("X-Student-Id", "99900000000000001");
        valid.Content = JsonContent.Create(new { contactInfo = "01712345678" });
        Assert.Equal(HttpStatusCode.Created, (await client.SendAsync(valid)).StatusCode);
    }

    [Fact]
    public async Task AdminCanEditAndDeleteClass()
    {
        var name = $"Editable {Guid.NewGuid()}";
        var classResponse = await client.PostAsJsonAsync("/classes", new { name, totalSeats = 2 });
        var cls = await classResponse.Content.ReadFromJsonAsync<CreateDto>();

        for (var i = 0; i < 2; i++)
        {
            using var hold = new HttpRequestMessage(HttpMethod.Post, $"/classes/{cls!.Id}/holds");
            hold.Headers.Add("X-Student-Id", $"4000000000000000{i}");
            Assert.Equal(HttpStatusCode.Created, (await client.SendAsync(hold)).StatusCode);
        }

        var shrink = await client.PutAsJsonAsync($"/classes/{cls!.Id}", new { name, totalSeats = 1 });
        Assert.Equal(HttpStatusCode.Conflict, shrink.StatusCode);

        var put = await client.PutAsJsonAsync($"/classes/{cls.Id}", new { name = $"{name} v2", totalSeats = 4 });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var updated = await client.GetFromJsonAsync<ClassDto>($"/classes/{cls.Id}");
        Assert.Equal($"{name} v2", updated!.Name);
        Assert.Equal(4, updated.TotalSeats);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/classes/{cls.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/classes/{cls.Id}")).StatusCode);
    }

    [Fact]
    public async Task AdminCanReadEnrolledStudentsWithTheirInformation()
    {
        var classResponse = await client.PostAsJsonAsync("/classes", new { name = $"Students {Guid.NewGuid()}", totalSeats = 2 });
        var cls = await classResponse.Content.ReadFromJsonAsync<CreateDto>();
        using var createHold = new HttpRequestMessage(HttpMethod.Post, $"/classes/{cls!.Id}/holds");
        createHold.Headers.Add("X-Student-Id", "50000000000000001");
        createHold.Content = JsonContent.Create(new { studentName = "Ayesha Rahman", fatherName = "Abdul Rahman", motherName = "Fatima Begum", contactInfo = "01712345678" });
        var hold = await (await client.SendAsync(createHold)).Content.ReadFromJsonAsync<HoldDto>();

        using var confirm = new HttpRequestMessage(HttpMethod.Post, $"/holds/{hold!.HoldId}/confirm");
        confirm.Headers.Add("X-Student-Id", "50000000000000001");
        confirm.Content = JsonContent.Create(new { paymentMethod = "Mobile banking", transactionId = "TX-MOBILE-1" });
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(confirm)).StatusCode);

        // The admin must verify the transaction ID before the student is enrolled.
        var awaiting = await client.GetFromJsonAsync<List<StudentDto>>($"/classes/{cls!.Id}/holds");
        var submitted = Assert.Single(awaiting!);
        Assert.Equal("PENDING", submitted.Status);
        Assert.Equal("Mobile banking", submitted.PaymentMethod);
        Assert.Equal("TX-MOBILE-1", submitted.TransactionId);

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"/holds/{hold.HoldId}/approve", null)).StatusCode);

        var students = await client.GetFromJsonAsync<List<StudentDto>>($"/classes/{cls.Id}/holds");
        var student = Assert.Single(students!);
        Assert.Equal("Ayesha Rahman", student.StudentName);
        Assert.Equal("Abdul Rahman", student.FatherName);
        Assert.Equal("Fatima Begum", student.MotherName);
        Assert.Equal("01712345678", student.ContactInfo);
        Assert.Equal("CONFIRMED", student.Status);
        Assert.Equal("Mobile banking", student.PaymentMethod);
        Assert.Equal("TX-MOBILE-1", student.TransactionId);
    }

    [Fact]
    public async Task AdminPendingPaymentsQueueListsSubmittedPayments()
    {
        var classResponse = await client.PostAsJsonAsync("/classes", new { name = $"Queue {Guid.NewGuid()}", totalSeats = 2 });
        var cls = await classResponse.Content.ReadFromJsonAsync<CreateDto>();
        using var createHold = new HttpRequestMessage(HttpMethod.Post, $"/classes/{cls!.Id}/holds");
        createHold.Headers.Add("X-Student-Id", "70000000000000001");
        createHold.Content = JsonContent.Create(new { studentName = "Queue Student", contactInfo = "01700000000" });
        var hold = await (await client.SendAsync(createHold)).Content.ReadFromJsonAsync<HoldDto>();

        using var confirm = new HttpRequestMessage(HttpMethod.Post, $"/holds/{hold!.HoldId}/confirm");
        confirm.Headers.Add("X-Student-Id", "70000000000000001");
        confirm.Content = JsonContent.Create(new { paymentMethod = "Banking", transactionId = "TX-QUEUE-1" });
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(confirm)).StatusCode);

        var queue = await client.GetFromJsonAsync<List<PendingPaymentDto>>("/admin/payments/pending");
        var payment = Assert.Single(queue!, x => x.HoldId == hold.HoldId);
        Assert.Equal("TX-QUEUE-1", payment.TransactionId);
        Assert.Equal("Queue Student", payment.StudentName);
        Assert.Equal("Banking", payment.PaymentMethod);

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"/holds/{hold.HoldId}/approve", null)).StatusCode);
        var after = await client.GetFromJsonAsync<List<PendingPaymentDto>>("/admin/payments/pending");
        Assert.DoesNotContain(after!, x => x.HoldId == hold.HoldId);
    }

    private sealed record CreateDto(string Id);
    private sealed record HoldDto(string HoldId);
    private sealed record ConfirmDto(string Status);
    private sealed record PendingPaymentDto(string HoldId, string StudentId, string? StudentName, string? PaymentMethod, string? TransactionId);
    private sealed record StudentDto(string StudentId, string? StudentName, string? FatherName, string? MotherName, string? ContactInfo, string Status, string? PaymentMethod, string? TransactionId);
    private sealed record ClassDto(string Id, string Name, int TotalSeats, int HeldSeats, int ConfirmedSeats, int AvailableSeats);
}
