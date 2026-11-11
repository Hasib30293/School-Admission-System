using Microsoft.EntityFrameworkCore;

namespace SchoolAdmission;

/// <summary>
/// Creates a small, realistic demo data set the first time the application runs against an
/// empty database. Existing databases are left untouched.
/// </summary>
public static class SeedData
{
    private sealed record StudentSeed(
        string ClassName, string Registration, string Name, string Father, string Mother,
        string Contact, string DateOfBirth, string Gender, string Address,
        HoldStatus Status, string? PaymentMethod, string? TransactionId, int DaysAgo);

    public static async Task EnsureSeededAsync(AdmissionDbContext db)
    {
        if (await db.Classes.AnyAsync()) return;

        var now = DateTimeOffset.UtcNow;

        var classes = new[]
        {
            new ClassOffering { Name = "Play Group - Morning Shift", TotalSeats = 60, CreatedAt = now.AddDays(-45) },
            new ClassOffering { Name = "Nursery - Morning Shift", TotalSeats = 80, CreatedAt = now.AddDays(-45) },
            new ClassOffering { Name = "Class 1 - Morning Shift", TotalSeats = 100, CreatedAt = now.AddDays(-45) },
            new ClassOffering { Name = "Class 5 - Day Shift", TotalSeats = 90, CreatedAt = now.AddDays(-45) },
            new ClassOffering { Name = "Class 8 - Day Shift", TotalSeats = 80, CreatedAt = now.AddDays(-45) },
            new ClassOffering { Name = "Class 10 - Evening Shift", TotalSeats = 70, CreatedAt = now.AddDays(-45) },
        };
        db.Classes.AddRange(classes);
        await db.SaveChangesAsync();

        var classIds = classes.ToDictionary(c => c.Name, c => c.Id);

        var students = new[]
        {
            new StudentSeed("Class 1 - Morning Shift", "20152691234567890", "Ayesha Rahman", "Abdul Rahman", "Fatima Begum",
                "01712345678", "2018-04-12", "Female", "House 12, Road 5, Dhanmondi, Dhaka", HoldStatus.Confirmed, "Mobile banking", "TRX-2026-000101", 20),
            new StudentSeed("Class 1 - Morning Shift", "20152691234567891", "Rahim Uddin", "Karim Uddin", "Rahima Khatun",
                "01812345678", "2018-06-03", "Male", "House 8, Road 3, Mirpur, Dhaka", HoldStatus.Confirmed, "Banking", "TRX-2026-000102", 18),
            new StudentSeed("Class 1 - Morning Shift", "20152691234567892", "Fatima Akter", "Jamal Hossain", "Nasima Begum",
                "01912345678", "2018-01-25", "Female", "Sector 7, Uttara, Dhaka", HoldStatus.Pending, "Mobile banking", "TRX-2026-000103", 2),

            new StudentSeed("Class 5 - Day Shift", "20152691234567893", "Tanvir Hasan", "Mizanur Rahman", "Shahida Parvin",
                "01612345678", "2013-09-18", "Male", "Agrabad, Chattogram", HoldStatus.Confirmed, "Banking", "TRX-2026-000104", 16),
            new StudentSeed("Class 5 - Day Shift", "20152691234567894", "Nusrat Jahan", "Shafiqul Islam", "Rokeya Begum",
                "01512345678", "2013-11-07", "Female", "Zindabazar, Sylhet", HoldStatus.Confirmed, "Mobile banking", "TRX-2026-000105", 14),

            new StudentSeed("Class 8 - Day Shift", "20152691234567895", "Sakib Ahmed", "Farid Ahmed", "Shirin Akter",
                "01722345678", "2010-02-14", "Male", "Shaheb Bazar, Rajshahi", HoldStatus.Pending, "Banking", "TRX-2026-000106", 1),
            new StudentSeed("Class 8 - Day Shift", "20152691234567896", "Mim Akter", "Anwar Hossain", "Salma Begum",
                "01822345678", "2010-08-21", "Female", "Sonadanga, Khulna", HoldStatus.Confirmed, "Mobile banking", "TRX-2026-000107", 12),

            new StudentSeed("Class 10 - Evening Shift", "20152691234567897", "Arif Hossain", "Delwar Hossain", "Monowara Begum",
                "01922345678", "2008-05-30", "Male", "Natun Bazar, Barishal", HoldStatus.Held, null, null, 0),
            new StudentSeed("Class 10 - Evening Shift", "20152691234567898", "Sadia Islam", "Nurul Islam", "Parvin Akter",
                "01622345678", "2008-12-11", "Female", "Jahaj Company More, Rangpur", HoldStatus.Confirmed, "Offline", "TRX-2026-000108", 10),

            new StudentSeed("Nursery - Morning Shift", "20152691234567899", "Rafiul Karim", "Habibur Rahman", "Amina Khatun",
                "01522345678", "2020-03-09", "Male", "Ganginar Par, Mymensingh", HoldStatus.Confirmed, "Banking", "TRX-2026-000109", 9),
            new StudentSeed("Nursery - Morning Shift", "20152691234567900", "Jannatul Ferdous", "Kamrul Hasan", "Rehana Begum",
                "01732345678", "2020-07-19", "Female", "Kandirpar, Cumilla", HoldStatus.Pending, "Mobile banking", "TRX-2026-000110", 3),

            new StudentSeed("Play Group - Morning Shift", "20152691234567901", "Mahin Chowdhury", "Shamsul Alam", "Tahmina Akter",
                "01832345678", "2022-01-15", "Male", "Chashara, Narayanganj", HoldStatus.Confirmed, "Banking", "TRX-2026-000111", 8),
            new StudentSeed("Play Group - Morning Shift", "20152691234567902", "Tahmina Begum", "Abdul Karim", "Ruma Khatun",
                "01932345678", "2022-06-27", "Female", "Joydebpur, Gazipur", HoldStatus.Confirmed, "Mobile banking", "TRX-2026-000112", 7),
            new StudentSeed("Play Group - Morning Shift", "20152691234567903", "Imran Khan", "Shahidul Islam", "Nasrin Sultana",
                "01632345678", "2022-10-05", "Male", "Sherpur, Bogura", HoldStatus.Held, null, null, 0),
        };

        var holds = new List<AdmissionHold>();
        var sequence = 1;
        foreach (var student in students)
        {
            var createdAt = now.AddDays(-student.DaysAgo).AddHours(-sequence);
            var paidAt = student.PaymentMethod is null ? (DateTimeOffset?)null : createdAt.AddHours(2);
            var confirmed = student.Status == HoldStatus.Confirmed;

            holds.Add(new AdmissionHold
            {
                ClassOfferingId = classIds[student.ClassName],
                StudentId = student.Registration,
                StudentName = student.Name,
                FatherName = student.Father,
                MotherName = student.Mother,
                ContactInfo = student.Contact,
                DateOfBirth = student.DateOfBirth,
                Gender = student.Gender,
                Address = student.Address,
                Status = student.Status,
                ApplicationReference = $"APP-{createdAt:yyyyMMdd}-{sequence:000000}",
                CreatedAt = createdAt,
                ExpiresAt = student.Status == HoldStatus.Held ? now.AddDays(60) : createdAt.AddMinutes(10),
                PaymentMethod = student.PaymentMethod,
                TransactionId = student.TransactionId,
                PaymentSubmittedAt = paidAt,
                ConfirmedAt = confirmed ? paidAt?.AddHours(1) : null,
                ReviewedAt = confirmed ? paidAt?.AddHours(1) : null,
                ReviewNote = confirmed ? "Payment verified." : null
            });
            sequence++;
        }

        db.Holds.AddRange(holds);
        await db.SaveChangesAsync();
    }
}
