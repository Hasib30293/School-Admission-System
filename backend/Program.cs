using System.Text.Json;
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
    db.Database.ExecuteSqlRaw("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_classes_Name' AND indexdef ILIKE '%UNIQUE%') THEN
                DROP INDEX "IX_classes_Name";
                CREATE INDEX "IX_classes_Name" ON classes ("Name");
            END IF;
        END $$;
        """);
    db.Database.ExecuteSqlRaw("""
        ALTER TABLE holds ADD COLUMN IF NOT EXISTS "StudentName" varchar(200);
        ALTER TABLE holds ADD COLUMN IF NOT EXISTS "ApplicationReference" varchar(40);
        ALTER TABLE holds ADD COLUMN IF NOT EXISTS "DateOfBirth" varchar(30);
        ALTER TABLE holds ADD COLUMN IF NOT EXISTS "Gender" varchar(30);
        ALTER TABLE holds ADD COLUMN IF NOT EXISTS "Address" varchar(500);
        ALTER TABLE holds ADD COLUMN IF NOT EXISTS "FatherName" varchar(200);
        ALTER TABLE holds ADD COLUMN IF NOT EXISTS "MotherName" varchar(200);
        ALTER TABLE holds ADD COLUMN IF NOT EXISTS "ContactInfo" varchar(100);
        ALTER TABLE holds ADD COLUMN IF NOT EXISTS "PaymentMethod" varchar(30);
        ALTER TABLE holds ADD COLUMN IF NOT EXISTS "TransactionId" varchar(100);
        ALTER TABLE holds ADD COLUMN IF NOT EXISTS "PaymentSubmittedAt" timestamptz;
        ALTER TABLE holds ADD COLUMN IF NOT EXISTS "ReviewedAt" timestamptz;
        ALTER TABLE holds ADD COLUMN IF NOT EXISTS "ReviewNote" varchar(300);
        ALTER TABLE holds ADD COLUMN IF NOT EXISTS "ConfirmedAt" timestamptz;
        UPDATE holds
        SET "ApplicationReference" = 'APP-' || to_char("CreatedAt", 'YYYYMMDD') || '-' || substring(replace("Id"::text, '-', '') from 1 for 6)
        WHERE "ApplicationReference" IS NULL OR "ApplicationReference" = '';
        """);
    db.Database.ExecuteSqlRaw("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_holds_ClassOfferingId_StudentId') THEN
                DROP INDEX "IX_holds_ClassOfferingId_StudentId";
            END IF;
        END $$;
        CREATE UNIQUE INDEX IF NOT EXISTS "IX_holds_ClassOfferingId_StudentId"
            ON holds ("ClassOfferingId", "StudentId")
            WHERE "Status" IN ('Held', 'Pending', 'Confirmed');
        """);
}

app.UseCors();
app.UseSwagger();
app.UseSwaggerUI();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapPost("/classes", async ([FromBody] CreateClassRequest request, AdmissionDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Length > 200 || request.TotalSeats <= 0)
        return Results.BadRequest(new { message = "Name is required and totalSeats must be greater than zero." });
    var entity = new ClassOffering { Name = request.Name.Trim(), TotalSeats = request.TotalSeats };
    db.Classes.Add(entity);
    await db.SaveChangesAsync();
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

app.MapPut("/classes/{classId:guid}", async (Guid classId, [FromBody] UpdateClassRequest request, AdmissionDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Length > 200 || request.TotalSeats <= 0)
        return Results.BadRequest(new { message = "Name is required and totalSeats must be greater than zero." });
    await using var tx = await db.Database.BeginTransactionAsync();
    var cls = await db.Classes.FromSqlInterpolated($"SELECT * FROM classes WHERE \"Id\" = {classId} FOR UPDATE").SingleOrDefaultAsync();
    if (cls is null) return Results.NotFound(new { message = "Class not found." });
    await ExpireDue(db, classId);
    var used = await db.Holds.CountAsync(x => x.ClassOfferingId == classId && (x.Status == HoldStatus.Held || x.Status == HoldStatus.Pending || x.Status == HoldStatus.Confirmed));
    if (request.TotalSeats < used) return Results.Conflict(new { message = $"Total seats cannot be lower than the {used} seats already held, awaiting approval or confirmed." });
    cls.Name = request.Name.Trim();
    cls.TotalSeats = request.TotalSeats;
    await db.SaveChangesAsync();
    await tx.CommitAsync();
    return Results.Ok(await BuildClassResponse(db, classId));
});

app.MapDelete("/classes/{classId:guid}", async (Guid classId, AdmissionDbContext db) =>
{
    var cls = await db.Classes.SingleOrDefaultAsync(x => x.Id == classId);
    if (cls is null) return Results.NotFound(new { message = "Class not found." });
    db.Classes.Remove(cls);
    await db.SaveChangesAsync();
    return Results.NoContent();
});

app.MapPost("/classes/{classId:guid}/holds", async (Guid classId, HttpRequest request, AdmissionDbContext db, IConfiguration config) =>
{
    var details = await ReadBody<CreateHoldRequest>(request);
    var studentId = details?.BirthRegistrationNumber?.Trim();
    if (studentId is null || !Regex.IsMatch(studentId, "^\\d{17}$")) studentId = StudentId(request);
    if (studentId is null) return Results.BadRequest(new { message = "Birth registration number must contain exactly 17 digits." });
    var contactInfo = Clean(details?.ContactInfo, 100);
    if (contactInfo is not null && !Regex.IsMatch(contactInfo, "^[0-9]{11}$"))
        return Results.BadRequest(new { message = "Contact number must be exactly 11 digits." });
    var duration = Math.Clamp(config.GetValue("HOLD_DURATION_SECONDS", 600), 1, 86400);
    await using var tx = await db.Database.BeginTransactionAsync();
    var cls = await db.Classes.FromSqlInterpolated($"SELECT * FROM classes WHERE \"Id\" = {classId} FOR UPDATE").SingleOrDefaultAsync();
    if (cls is null) return Results.NotFound(new { message = "Class not found." });
    await ExpireDue(db, classId);
    var existing = await db.Holds.AnyAsync(x => x.ClassOfferingId == classId && x.StudentId == studentId && (x.Status == HoldStatus.Held || x.Status == HoldStatus.Pending || x.Status == HoldStatus.Confirmed));
    if (existing) return Results.Conflict(new { message = "This student already has an active application for this class." });
    var used = await db.Holds.CountAsync(x => x.ClassOfferingId == classId && (x.Status == HoldStatus.Held || x.Status == HoldStatus.Pending || x.Status == HoldStatus.Confirmed));
    if (used >= cls.TotalSeats) return Results.Conflict(new { message = "No seats are currently available." });
    if (details?.BirthRegistrationNumber is not null && (string.IsNullOrWhiteSpace(details.StudentName) || string.IsNullOrWhiteSpace(contactInfo)))
        return Results.BadRequest(new { message = "Student name and contact number are required." });
    var hold = new AdmissionHold
    {
        ClassOfferingId = classId,
        StudentId = studentId,
        ApplicationReference = $"APP-{DateTimeOffset.UtcNow:yyyyMMdd}-{Random.Shared.Next(100000, 999999)}",
        StudentName = Clean(details?.StudentName, 200),
        DateOfBirth = Clean(details?.DateOfBirth, 30),
        Gender = Clean(details?.Gender, 30),
        FatherName = Clean(details?.FatherName, 200),
        MotherName = Clean(details?.MotherName, 200),
        ContactInfo = contactInfo,
        Address = Clean(details?.Address, 500),
        ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(duration)
    };
    db.Holds.Add(hold);
    await db.SaveChangesAsync(); await tx.CommitAsync();
    return Results.Created($"/holds/{hold.Id}", new { holdId = hold.Id.ToString(), applicationReference = hold.ApplicationReference, classId = classId.ToString(), studentId, status = "HELD", expiresAt = hold.ExpiresAt });
});

app.MapGet("/applications/search", async (string? birthRegistrationNumber, AdmissionDbContext db) =>
{
    if (birthRegistrationNumber is null || !Regex.IsMatch(birthRegistrationNumber, "^\\d{17}$"))
        return Results.BadRequest(new { message = "Birth registration number must contain exactly 17 digits." });
    await ExpireDue(db);
    var applications = await db.Holds.AsNoTracking().Include(x => x.ClassOffering)
        .Where(x => x.StudentId == birthRegistrationNumber)
        .OrderByDescending(x => x.CreatedAt).ToListAsync();
    return Results.Ok(applications.Select(ToApplicationResponse));
});

app.MapGet("/classes/{classId:guid}/holds", async (Guid classId, AdmissionDbContext db) =>
{
    if (!await db.Classes.AnyAsync(x => x.Id == classId)) return Results.NotFound(new { message = "Class not found." });
    await ExpireDue(db, classId);
    var holds = await db.Holds.AsNoTracking()
        .Where(x => x.ClassOfferingId == classId && (x.Status == HoldStatus.Held || x.Status == HoldStatus.Pending || x.Status == HoldStatus.Confirmed))
        .OrderByDescending(x => x.CreatedAt)
        .ToListAsync();
    return Results.Ok(holds.Select(x => new EnrolledStudentResponse(
        x.Id.ToString(), x.StudentId, x.StudentName, x.FatherName, x.MotherName, x.ContactInfo,
        x.Status.ToString().ToUpperInvariant(), x.PaymentMethod, x.TransactionId, x.PaymentSubmittedAt, x.ReviewNote,
        x.CreatedAt, x.ExpiresAt, x.ConfirmedAt)));
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
    if (hold.StudentId != studentId) return Results.Json(new { message = "You can only manage your own application." }, statusCode: StatusCodes.Status403Forbidden);
    if (hold.Status == HoldStatus.Confirmed) return Results.Ok(new { holdId = hold.Id.ToString(), status = "CONFIRMED" });
    if (hold.Status == HoldStatus.Pending) return Results.Ok(new { holdId = hold.Id.ToString(), status = "PENDING", paymentMethod = hold.PaymentMethod, transactionId = hold.TransactionId });
    if (hold.Status != HoldStatus.Held || hold.ExpiresAt <= DateTimeOffset.UtcNow) return Results.Conflict(new { message = "This hold has expired or is no longer active." });
    var payment = await ReadBody<ConfirmPaymentRequest>(request);
    var transactionId = payment?.TransactionId?.Trim();
    if (string.IsNullOrWhiteSpace(transactionId)) return Results.BadRequest(new { message = "Transaction ID is required to submit the payment." });
    if (transactionId.Length > 100) return Results.BadRequest(new { message = "Transaction ID cannot be longer than 100 characters." });
    var paymentMethod = payment?.PaymentMethod?.Trim();
    if (paymentMethod is not ("Banking" or "Mobile banking" or "Offline")) return Results.BadRequest(new { message = "Select a valid payment method." });
    // Payment is recorded but the admission is not confirmed until an admin verifies the transaction.
    hold.Status = HoldStatus.Pending;
    hold.PaymentMethod = paymentMethod;
    hold.TransactionId = transactionId;
    hold.PaymentSubmittedAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(new { holdId = hold.Id.ToString(), status = "PENDING", paymentMethod, transactionId, message = "Payment details submitted. An admin must verify the transaction ID before the seat is confirmed." });
});

app.MapGet("/admin/payments/pending", async (AdmissionDbContext db) =>
{
    var pending = await db.Holds.AsNoTracking().Include(x => x.ClassOffering)
        .Where(x => x.Status == HoldStatus.Pending)
        .OrderBy(x => x.PaymentSubmittedAt)
        .ToListAsync();
    return Results.Ok(pending.Select(x => new PendingPaymentResponse(
        x.Id.ToString(), x.ClassOfferingId.ToString(), x.ClassOffering?.Name ?? "", x.StudentId,
        x.StudentName, x.FatherName, x.MotherName, x.ContactInfo, x.PaymentMethod, x.TransactionId,
        x.PaymentSubmittedAt, x.CreatedAt)));
});

app.MapPost("/holds/{holdId:guid}/approve", async (Guid holdId, HttpRequest request, AdmissionDbContext db) =>
{
    await using var tx = await db.Database.BeginTransactionAsync();
    var hold = await db.Holds.FromSqlInterpolated($"SELECT * FROM holds WHERE \"Id\" = {holdId} FOR UPDATE").SingleOrDefaultAsync();
    if (hold is null) return Results.NotFound(new { message = "Application not found." });
    if (hold.Status == HoldStatus.Confirmed) return Results.Ok(new { holdId = hold.Id.ToString(), status = "CONFIRMED" });
    if (hold.Status != HoldStatus.Pending) return Results.Conflict(new { message = "Only a payment awaiting verification can be approved." });
    var review = await ReadBody<ReviewPaymentRequest>(request);
    hold.Status = HoldStatus.Confirmed;
    hold.ConfirmedAt = DateTimeOffset.UtcNow;
    hold.ReviewedAt = DateTimeOffset.UtcNow;
    hold.ReviewNote = Clean(review?.Note, 300);
    await db.SaveChangesAsync();
    await tx.CommitAsync();
    return Results.Ok(new { holdId = hold.Id.ToString(), status = "CONFIRMED", transactionId = hold.TransactionId });
});

app.MapPost("/holds/{holdId:guid}/reject", async (Guid holdId, HttpRequest request, AdmissionDbContext db) =>
{
    await using var tx = await db.Database.BeginTransactionAsync();
    var hold = await db.Holds.FromSqlInterpolated($"SELECT * FROM holds WHERE \"Id\" = {holdId} FOR UPDATE").SingleOrDefaultAsync();
    if (hold is null) return Results.NotFound(new { message = "Application not found." });
    if (hold.Status == HoldStatus.Rejected) return Results.Ok(new { holdId = hold.Id.ToString(), status = "REJECTED" });
    if (hold.Status != HoldStatus.Pending) return Results.Conflict(new { message = "Only a payment awaiting verification can be rejected." });
    var review = await ReadBody<ReviewPaymentRequest>(request);
    hold.Status = HoldStatus.Rejected;
    hold.ReviewedAt = DateTimeOffset.UtcNow;
    hold.ReviewNote = Clean(review?.Note, 300);
    await db.SaveChangesAsync();
    await tx.CommitAsync();
    return Results.Ok(new { holdId = hold.Id.ToString(), status = "REJECTED", note = hold.ReviewNote });
});

app.MapDelete("/holds/{holdId:guid}", async (Guid holdId, HttpRequest request, AdmissionDbContext db) =>
{
    var studentId = StudentId(request);
    if (studentId is null) return Results.BadRequest(new { message = "X-Student-Id must contain exactly 17 digits." });
    await ExpireDue(db);
    var hold = await db.Holds.SingleOrDefaultAsync(x => x.Id == holdId);
    if (hold is null) return Results.NotFound(new { message = "Application not found." });
    if (hold.StudentId != studentId) return Results.Json(new { message = "You can only manage your own application." }, statusCode: StatusCodes.Status403Forbidden);
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
static string? Clean(string? value, int maxLength)
{
    if (string.IsNullOrWhiteSpace(value)) return null;
    var trimmed = value.Trim();
    return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
}
static async Task<T?> ReadBody<T>(HttpRequest request)
{
    if (request.ContentLength is null or 0) return default;
    try { return await JsonSerializer.DeserializeAsync<T>(request.Body, new JsonSerializerOptions(JsonSerializerDefaults.Web)); }
    catch { return default; }
}
static async Task ExpireDue(AdmissionDbContext db, Guid? classId = null)
{
    // Pending payments are deliberately not expired: the student has submitted payment details
    // and the seat stays reserved until an admin approves or rejects the transaction.
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
        c.Holds.Count(h => h.Status == HoldStatus.Held || h.Status == HoldStatus.Pending),
        c.Holds.Count(h => h.Status == HoldStatus.Confirmed),
        c.TotalSeats - c.Holds.Count(h => h.Status == HoldStatus.Held || h.Status == HoldStatus.Pending) - c.Holds.Count(h => h.Status == HoldStatus.Confirmed),
        c.Holds.Count(h => h.Status == HoldStatus.Pending))).ToListAsync();
}
static async Task<ClassResponse?> BuildClassResponse(AdmissionDbContext db, Guid id) => (await BuildClassResponses(db)).SingleOrDefault(x => x.Id == id.ToString());
static object ToHoldResponse(AdmissionHold h, bool includeStudent) => new
{
    holdId = h.Id.ToString(),
    classId = h.ClassOfferingId.ToString(),
    className = h.ClassOffering?.Name,
    studentId = includeStudent ? h.StudentId : null,
    status = h.Status.ToString().ToUpperInvariant(),
    expiresAt = h.ExpiresAt,
    paymentMethod = h.PaymentMethod,
    transactionId = h.TransactionId,
    paymentSubmittedAt = h.PaymentSubmittedAt,
    confirmedAt = h.ConfirmedAt,
    reviewNote = h.ReviewNote
};
static ApplicationResponse ToApplicationResponse(AdmissionHold h)
{
    var className = h.ClassOffering?.Name ?? "";
    var match = Regex.Match(className, "^(.*?)\\s*-\\s*(Morning|Day|Evening)(?:\\s+Shift)?$", RegexOptions.IgnoreCase);
    var displayClass = match.Success ? match.Groups[1].Value.Trim() : className;
    var shift = match.Success ? match.Groups[2].Value : "Morning";
    var appStatus = h.Status switch { HoldStatus.Held => "Waiting for Payment", HoldStatus.Pending => "Payment Under Review", HoldStatus.Confirmed => "Admitted", HoldStatus.Rejected => "Payment Rejected", HoldStatus.Expired => "Expired", _ => h.Status.ToString() };
    var paymentStatus = h.Status is HoldStatus.Pending or HoldStatus.Confirmed ? "Paid" : "Unpaid";
    return new ApplicationResponse(h.Id.ToString(), h.ApplicationReference, h.ClassOfferingId.ToString(), displayClass, shift, h.StudentName ?? "", h.StudentId, h.DateOfBirth, h.Gender, h.FatherName, h.MotherName, h.ContactInfo, h.Address, h.CreatedAt, appStatus, paymentStatus, h.ExpiresAt, h.PaymentMethod, h.TransactionId, h.ReviewNote);
}

public partial class Program { }
