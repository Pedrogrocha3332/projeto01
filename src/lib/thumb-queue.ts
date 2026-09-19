// Global concurrency queue to throttle expensive background work
// (e.g. generating video thumbnails). Prevents dozens of simultaneous
// <video> element loads that freeze the main thread.

type Task<T> = () => Promise<T>;

class ConcurrencyQueue {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  run<T>(task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const attempt = () => {
        if (this.running >= this.limit) {
          this.queue.push(attempt);
          return;
        }
        this.running++;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.running--;
            const next = this.queue.shift();
            if (next) next();
          });
      };
      attempt();
    });
  }
}

export const thumbQueue = new ConcurrencyQueue(2);
