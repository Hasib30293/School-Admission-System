using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

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
        var result = await client.GetFromJsonAsync<ClassDto>($"/classes/{cls.Id}");
        Assert.True(result!.HeldSeats + result.ConfirmedSeats <= result.TotalSeats);
    }

    private sealed record CreateDto(string Id);
    private sealed record ClassDto(string Id, string Name, int TotalSeats, int HeldSeats, int ConfirmedSeats, int AvailableSeats);
}
