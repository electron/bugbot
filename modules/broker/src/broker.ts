import { Task } from './task';

export class Broker {
  private readonly tasks: Map<string, Task> = new Map();

  public addTask(task: Task): void {
    this.tasks.set(task.id, task);
  }

  public getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  public getTasks(): Task[] {
    return [...this.tasks.values()];
  }
}
