export type Incident = {
  id: string;
  number: string;
  state?: string;
  openedAt?: string;
  description?: string;
  summary?: string;
  summaryStructured?: SummaryStructured | null;
  raw?: unknown;
  cdnAttachments?: Attachment[];
  status?: "open" | "resolved";
  callAttempts?: number;
  noAnswerCount?: number;
  opsHelp?: boolean;
  updatedAt?: number;
};

export type CommentType = "ops" | "pm" | "dev";

export type Comment = {
  id: string;
  text: string;
  type: CommentType;
  authorName: string;
  authorUid: string;
  createdAt: number;
  updatedAt?: number;
};

export type SummaryStructured = {
  title: string;
  what_happened?: string;
  key_timeline?: string[];
  current_application_state?: string;
  evidence?: string[];
  attachments?: string[];
};

export type Attachment = {
  fileName?: string;
  name?: string;
  size?: string;
  sizeBytes?: number;
  url?: string;
  href?: string;
  link?: string;
  base64?: string;
  contentType?: string;
};
