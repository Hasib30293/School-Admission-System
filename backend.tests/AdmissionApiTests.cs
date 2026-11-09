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
    public async Task ConfirmIsIdempotentAndOwnershipIsEnforced()
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
        using var ownConfirm2 = new HttpRequestMessage(HttpMethod.Post, $"/holds/{hold.HoldId}/confirm");
        ownConfirm2.Headers.Add("X-Student-Id", "30000000000000001");
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(ownConfirm1)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(ownConfirm2)).StatusCode);

        var after = await client.GetFromJsonAsync<ClassDto>($"/classes/{cls!.Id}");
        Assert.Equal(1, after!.ConfirmedSeats);
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

    private sealed record CreateDto(string Id);
    private sealed record HoldDto(string HoldId);
    private sealed record ClassDto(string Id, string Name, int TotalSeats, int HeldSeats, int ConfirmedSeats, int AvailableSeats);
}
