export interface ComponentReference {
  id: string;
  version: string;
}

export interface Connection {
  from: string;
  to: string;
}

export interface Recipe {
  name?: string;
  components: ComponentReference[];
  connections: Connection[];
  parameters: Record<string, Record<string, unknown>>;
}
