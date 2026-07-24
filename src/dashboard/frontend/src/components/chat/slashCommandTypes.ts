export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  insert: string;
  category?: string;
}
