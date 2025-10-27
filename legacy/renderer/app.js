// Simple tabs
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // Download console log button
  document.getElementById('download-console')?.addEventListener('click', () => {
    const logs = [];
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    // Capture console methods
    console.log = (...args) => {
      logs.push(`[LOG] ${args.join(' ')}`);
      originalLog.apply(console, args);
    };
    console.error = (...args) => {
      logs.push(`[ERROR] ${args.join(' ')}`);
      originalError.apply(console, args);
    };
    console.warn = (...args) => {
      logs.push(`[WARN] ${args.join(' ')}`);
      originalWarn.apply(console, args);
    };

    // Get existing logs from console
    const logText = logs.join('\n');

    // Download as text file
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus-console-${new Date().toISOString().replace(/:/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    console.log('[Download] Console log downloaded');
  });
});
