namespace SchoolAdmission;

public enum HoldStatus { Held, Pending, Confirmed, Expired, Cancelled, Rejected }

public sealed class ClassOffering
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public int TotalSeats { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<AdmissionHold> Holds { get; set; } = [];
}

public sealed class AdmissionHold
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ClassOfferingId { get; set; }
    public ClassOffering? ClassOffering { get; set; }
    public string StudentId { get; set; } = "";
    public string ApplicationReference { get; set; } = $"APP-{DateTimeOffset.UtcNow:yyyyMMdd}-{Random.Shared.Next(100000, 999999)}";
    public string? StudentName { get; set; }
    public string? DateOfBirth { get; set; }
    public string? Gender { get; set; }
    public string? FatherName { get; set; }
    public string? MotherName { get; set; }
    public string? ContactInfo { get; set; }
    public string? Address { get; set; }
    public HoldStatus Status { get; set; } = HoldStatus.Held;
    public string? PaymentMethod { get; set; }
    public string? TransactionId { get; set; }
    public DateTimeOffset? PaymentSubmittedAt { get; set; }
    public DateTimeOffset? ReviewedAt { get; set; }
    public string? ReviewNote { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? ConfirmedAt { get; set; }
}

public sealed record CreateClassRequest(string? Name, int TotalSeats);
public sealed record UpdateClassRequest(string? Name, int TotalSeats);
public sealed record ClassResponse(string Id, string Name, int TotalSeats, int HeldSeats, int ConfirmedSeats, int AvailableSeats, int PendingSeats);
public sealed record HoldResponse(string HoldId, string ClassId, string? ClassName, string? StudentId, string Status, DateTimeOffset? ExpiresAt, string? PaymentMethod, string? TransactionId, DateTimeOffset? PaymentSubmittedAt, DateTimeOffset? ConfirmedAt, string? ReviewNote);
public sealed record CreateHoldRequest(string? StudentName, string? FatherName, string? MotherName, string? ContactInfo, string? BirthRegistrationNumber, string? DateOfBirth, string? Gender, string? Address);
public sealed record ApplicationResponse(string HoldId, string ApplicationReference, string ClassId, string ClassName, string Shift, string StudentName, string BirthRegistrationNumber, string? DateOfBirth, string? Gender, string? FatherName, string? MotherName, string? ContactNumber, string? Address, DateTimeOffset CreatedAt, string ApplicationStatus, string PaymentStatus, DateTimeOffset? SeatHoldExpiry, string? PaymentMethod, string? TransactionId, string? ReviewNote);
public sealed record ConfirmPaymentRequest(string? PaymentMethod, string? TransactionId);
public sealed record ReviewPaymentRequest(string? Note);
public sealed record PendingPaymentResponse(string HoldId, string ClassId, string ClassName, string StudentId, string? StudentName, string? FatherName, string? MotherName, string? ContactInfo, string? PaymentMethod, string? TransactionId, DateTimeOffset? PaymentSubmittedAt, DateTimeOffset CreatedAt);
public sealed record EnrolledStudentResponse(string HoldId, string StudentId, string? StudentName, string? FatherName, string? MotherName, string? ContactInfo, string Status, string? PaymentMethod, string? TransactionId, DateTimeOffset? PaymentSubmittedAt, string? ReviewNote, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, DateTimeOffset? ConfirmedAt);
