import { Task } from './task';

export class Broker {
  private readonly tasks: Map<string, Task> = new Map();

  public addTask(task: Task): void {
    this.tasks.set(task.id, task);
    console.log(`broker added task ${task.id}`);
  }

  public getTasks(): Task[] {
    return [...this.tasks.values()];
  }
}
