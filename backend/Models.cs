namespace SchoolAdmission;

public enum HoldStatus { Held, Confirmed, Expired, Cancelled }

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
    public HoldStatus Status { get; set; } = HoldStatus.Held;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset ExpiresAt { get; set; }
}

public sealed record CreateClassRequest(string? Name, int TotalSeats);
public sealed record UpdateClassRequest(string? Name, int TotalSeats);
public sealed record ClassResponse(string Id, string Name, int TotalSeats, int HeldSeats, int ConfirmedSeats, int AvailableSeats);
public sealed record HoldResponse(string HoldId, string ClassId, string? ClassName, string? StudentId, string Status, DateTimeOffset? ExpiresAt);
public sealed record ConfirmResponse(string HoldId, string Status);
