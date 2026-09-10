import Dexie, { type Table } from "dexie";
import { same, type Event } from "../contract";
export class EventStore extends Dexie {
  events!: Table<Event, string>;
  traces!: Table<
    { id: string; sessionId: string; spans: unknown[]; dropped?: number },
    string
  >;
  constructor(name = "cuelayer-v2") {
    super(name);
    this.version(1).stores({
      events: "id,&[sessionId+sequence],sessionId",
      traces: "id,sessionId",
    });
  }
  read(sessionId: string) {
    return this.events
      .where("[sessionId+sequence]")
      .between([sessionId, 0], [sessionId, Infinity])
      .toArray();
  }
  async append(event: Event, expected: number) {
    await this.transaction("rw", this.events, async () => {
      const duplicate = await this.events.get(event.id);
      if (duplicate) {
        if (!same(duplicate, event))
          throw new Error("event-identity-collision");
        return;
      }
      const last = await this.events
        .where("[sessionId+sequence]")
        .between([event.sessionId, 0], [event.sessionId, Infinity])
        .last();
      if ((last?.sequence ?? 0) !== expected)
        throw new Error("competing-writer");
      await this.events.add(event);
    });
  }
  async exportSession(sessionId: string) {
    const events = await this.read(sessionId);
    return JSON.stringify({
      schema: events.some((e) => e.schema === "cuelayer-v2-event-2")
        ? "cuelayer-v2-export-2"
        : "cuelayer-v2-export-1",
      events,
    });
  }
  async deleteSession(sessionId: string) {
    await this.transaction("rw", this.events, this.traces, async () => {
      await this.events.where("sessionId").equals(sessionId).delete();
      await this.traces.where("sessionId").equals(sessionId).delete();
    });
  }
  // V2 never opens the legacy database. Import requires an explicitly versioned migration.
}
