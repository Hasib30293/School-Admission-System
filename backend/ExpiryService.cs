using Microsoft.EntityFrameworkCore;

namespace SchoolAdmission;

public sealed class ExpiryService(IServiceScopeFactory scopeFactory, ILogger<ExpiryService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AdmissionDbContext>();
                var expired = await db.Holds.Where(x => x.Status == HoldStatus.Held && x.ExpiresAt <= DateTimeOffset.UtcNow).ToListAsync(stoppingToken);
                foreach (var hold in expired) hold.Status = HoldStatus.Expired;
                if (expired.Count > 0) await db.SaveChangesAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch (Exception ex) { logger.LogError(ex, "Hold expiry sweep failed"); }
            await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
        }
    }
}
