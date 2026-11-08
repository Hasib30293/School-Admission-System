using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using SchoolAdmission;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<AdmissionDbContext>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
builder.Services.AddHostedService<ExpiryService>();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));
var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AdmissionDbContext>();
    var retries = 0;
    while (true)
    {
        try { db.Database.EnsureCreated(); break; }
        catch when (retries++ < 20) { Thread.Sleep(1000); }
    }
}

app.UseCors();
app.UseSwagger();
app.UseSwaggerUI();

app.MapPost("/classes", async ([FromBody] CreateClassRequest request, AdmissionDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Length > 200 || request.TotalSeats <= 0)
        return Results.BadRequest(new { message = "Name is required and totalSeats must be greater than zero." });
    var entity = new ClassOffering { Name = request.Name.Trim(), TotalSeats = request.TotalSeats };
    db.Classes.Add(entity);
    try { await db.SaveChangesAsync(); }
    catch (DbUpdateException) { return Results.Conflict(new { message = "A class with this name already exists." }); }
    return Results.Created($"/classes/{entity.Id}", new { id = entity.Id.ToString(), name = entity.Name, totalSeats = entity.TotalSeats });
});

app.MapGet("/classes", async (AdmissionDbContext db) =>
    Results.Ok(await BuildClassResponses(db)));

app.MapGet("/classes/{classId:guid}", async (Guid classId, AdmissionDbContext db) =>
{
    await ExpireDue(db);
    var result = await BuildClassResponse(db, classId);
    return result is null ? Results.NotFound(new { message = "Class not found." }) : Results.Ok(result);
});

app.MapPost("/classes/{classId:guid}/holds", async (Guid classId, HttpRequest request, AdmissionDbContext db, IConfiguration config) =>
{
    var studentId = StudentId(request);
    if (studentId is null) return Results.BadRequest(new { message = "X-Student-Id must contain exactly 17 digits." });
    var duration = Math.Clamp(config.GetValue("HOLD_DURATION_SECONDS", 600), 1, 86400);
    await using var tx = await db.Database.BeginTransactionAsync();
    var cls = await db.Classes.FromSqlInterpolated($"SELECT * FROM classes WHERE \"Id\" = {classId} FOR UPDATE").SingleOrDefaultAsync();
    if (cls is null) return Results.NotFound(new { message = "Class not found." });
    await ExpireDue(db, classId);
    var existing = await db.Holds.AnyAsync(x => x.ClassOfferingId == classId && x.StudentId == studentId && (x.Status == HoldStatus.Held || x.Status == HoldStatus.Confirmed));
    if (existing) return Results.Conflict(new { message = "This student already has an active application for this class." });
    var used = await db.Holds.CountAsync(x => x.ClassOfferingId == classId && (x.Status == HoldStatus.Held || x.Status == HoldStatus.Confirmed));
    if (used >= cls.TotalSeats) return Results.Conflict(new { message = "No seats are currently available." });
    var hold = new AdmissionHold { ClassOfferingId = classId, StudentId = studentId, ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(duration) };
    db.Holds.Add(hold);
    await db.SaveChangesAsync(); await tx.CommitAsync();
    return Results.Created($"/holds/{hold.Id}", new { holdId = hold.Id.ToString(), classId = classId.ToString(), studentId, status = "HELD", expiresAt = hold.ExpiresAt });
});

app.MapGet("/holds/{holdId:guid}", async (Guid holdId, AdmissionDbContext db) =>
{
    await ExpireDue(db);
    var h = await db.Holds.AsNoTracking().Include(x => x.ClassOffering).SingleOrDefaultAsync(x => x.Id == holdId);
    return h is null ? Results.NotFound(new { message = "Application not found." }) : Results.Ok(ToHoldResponse(h, false));
});

app.MapPost("/holds/{holdId:guid}/confirm", async (Guid holdId, HttpRequest request, AdmissionDbContext db) =>
{
    var studentId = StudentId(request);
    if (studentId is null) return Results.BadRequest(new { message = "X-Student-Id must contain exactly 17 digits." });
    await ExpireDue(db);
    var hold = await db.Holds.SingleOrDefaultAsync(x => x.Id == holdId);
    if (hold is null) return Results.NotFound(new { message = "Application not found." });
    if (hold.StudentId != studentId) return Results.Forbid();
    if (hold.Status == HoldStatus.Confirmed) return Results.Ok(new { holdId = hold.Id.ToString(), status = "CONFIRMED" });
    if (hold.Status != HoldStatus.Held || hold.ExpiresAt <= DateTimeOffset.UtcNow) return Results.Conflict(new { message = "This hold has expired or is no longer active." });
    hold.Status = HoldStatus.Confirmed;
    await db.SaveChangesAsync();
    return Results.Ok(new { holdId = hold.Id.ToString(), status = "CONFIRMED" });
});

app.MapDelete("/holds/{holdId:guid}", async (Guid holdId, HttpRequest request, AdmissionDbContext db) =>
{
    var studentId = StudentId(request);
    if (studentId is null) return Results.BadRequest(new { message = "X-Student-Id must contain exactly 17 digits." });
    var hold = await db.Holds.SingleOrDefaultAsync(x => x.Id == holdId);
    if (hold is null) return Results.NotFound(new { message = "Application not found." });
    if (hold.StudentId != studentId) return Results.Forbid();
    if (hold.Status is HoldStatus.Held) { hold.Status = HoldStatus.Cancelled; await db.SaveChangesAsync(); }
    return Results.NoContent();
});

app.MapGet("/me/holds", async (HttpRequest request, AdmissionDbContext db) =>
{
    var studentId = StudentId(request);
    if (studentId is null) return Results.BadRequest(new { message = "X-Student-Id must contain exactly 17 digits." });
    await ExpireDue(db);
    var holds = await db.Holds.AsNoTracking().Include(x => x.ClassOffering).Where(x => x.StudentId == studentId).OrderByDescending(x => x.CreatedAt).ToListAsync();
    return Results.Ok(holds.Select(x => ToHoldResponse(x, true)));
});

app.Run();

static string? StudentId(HttpRequest request) => request.Headers.TryGetValue("X-Student-Id", out var value) && Regex.IsMatch(value.ToString(), "^\\d{17}$") ? value.ToString() : null;
static async Task ExpireDue(AdmissionDbContext db, Guid? classId = null)
{
    var query = db.Holds.Where(x => x.Status == HoldStatus.Held && x.ExpiresAt <= DateTimeOffset.UtcNow);
    if (classId.HasValue) query = query.Where(x => x.ClassOfferingId == classId.Value);
    var due = await query.ToListAsync();
    foreach (var x in due) x.Status = HoldStatus.Expired;
    if (due.Count > 0) await db.SaveChangesAsync();
}
static async Task<List<ClassResponse>> BuildClassResponses(AdmissionDbContext db)
{
    await ExpireDue(db);
    return await db.Classes.AsNoTracking().Select(c => new ClassResponse(c.Id.ToString(), c.Name, c.TotalSeats,
        c.Holds.Count(h => h.Status == HoldStatus.Held), c.Holds.Count(h => h.Status == HoldStatus.Confirmed),
        c.TotalSeats - c.Holds.Count(h => h.Status == HoldStatus.Held) - c.Holds.Count(h => h.Status == HoldStatus.Confirmed))).ToListAsync();
}
static async Task<ClassResponse?> BuildClassResponse(AdmissionDbContext db, Guid id) => (await BuildClassResponses(db)).SingleOrDefault(x => x.Id == id.ToString());
static object ToHoldResponse(AdmissionHold h, bool includeStudent) => new { holdId = h.Id.ToString(), classId = h.ClassOfferingId.ToString(), className = h.ClassOffering?.Name, studentId = includeStudent ? h.StudentId : null, status = h.Status.ToString().ToUpperInvariant(), expiresAt = h.ExpiresAt };

public partial class Program { }
