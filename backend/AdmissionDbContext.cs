using Microsoft.EntityFrameworkCore;

namespace SchoolAdmission;

public sealed class AdmissionDbContext(DbContextOptions<AdmissionDbContext> options) : DbContext(options)
{
    public DbSet<ClassOffering> Classes => Set<ClassOffering>();
    public DbSet<AdmissionHold> Holds => Set<AdmissionHold>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ClassOffering>(e =>
        {
            e.ToTable("classes");
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(200).IsRequired();
            e.HasIndex(x => x.Name);
        });
        modelBuilder.Entity<AdmissionHold>(e =>
        {
            e.ToTable("holds");
            e.HasKey(x => x.Id);
            e.Property(x => x.StudentId).HasMaxLength(17).IsRequired();
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(12);
            e.HasOne(x => x.ClassOffering).WithMany(x => x.Holds).HasForeignKey(x => x.ClassOfferingId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.ClassOfferingId, x.StudentId }).HasFilter("\"Status\" IN ('Held', 'Confirmed')").IsUnique();
            e.HasIndex(x => new { x.Status, x.ExpiresAt });
        });
    }
}
