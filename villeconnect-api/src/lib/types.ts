// =============================================================================
// VilleConnect Copilot OS — Types TypeScript (générés manuellement depuis schema v2)
// =============================================================================

// ── Enums ─────────────────────────────────────────────────────────────────────
export type ActionStatus =
  | 'draft'
  | 'pending_validation'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type RiskLevel   = 'low' | 'medium' | 'high' | 'critical';
export type RequestChannel = 'web' | 'mobile' | 'telegram' | 'whatsapp';
export type UserRole    = 'citizen' | 'agent' | 'admin' | 'superadmin';

export type AnnouncementStatus   = 'draft' | 'pending_validation' | 'published' | 'archived' | 'rejected';
export type AnnouncementCategory = 'info' | 'event' | 'alert' | 'commercial';
export type AnnouncementPriority = 'low' | 'medium' | 'high' | 'urgent';

export type CampaignStatus = 'draft' | 'pending_validation' | 'active' | 'paused' | 'completed' | 'cancelled';
export type BugSeverity    = 'low' | 'medium' | 'high' | 'critical';
export type BugStatus      = 'open' | 'triaged' | 'in_progress' | 'resolved' | 'closed';
export type TaskStatus     = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type TaskPriority   = 'low' | 'medium' | 'high' | 'urgent';
export type TaskCategory   = 'content' | 'technical' | 'admin' | 'communication' | 'legal';
export type N8nWorkflowName = 'publish_announcement' | 'activate_campaign' | 'notify_bug_resolved' | 'send_notification';

// ── Entités Supabase ───────────────────────────────────────────────────────────
export interface VcCity {
  id: string;
  name: string;
  slug: string;
  region: string | null;
  country: string;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface VcConversation {
  id: string;
  city_id: string;
  user_id: string | null;
  session_id: string;
  channel: RequestChannel;
  status: 'active' | 'closed' | 'archived';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface VcMessage {
  id: string;
  conversation_id: string;
  city_id: string;
  user_id: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  embedding: number[] | null;
  tokens_used: number | null;
  model_used: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface VcAnnouncement {
  id: string;
  city_id: string;
  author_id: string | null;
  title: string;
  content: string;
  category: AnnouncementCategory;
  status: AnnouncementStatus;
  priority: AnnouncementPriority;
  publish_at: string | null;
  expires_at: string | null;
  ai_generated: boolean;
  ai_draft: Record<string, unknown> | null;
  validated_by: string | null;
  validated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiActionLog {
  id: string;
  city_id: string | null;
  status: ActionStatus;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  agent_name: string;
  run_id: string | null;
  run_state: RunStatePayload | null;       // état sérialisé du run HITL
  interruption_data: InterruptionData | null;
  input_summary: string;
  output_summary: string | null;
  risk_level: RiskLevel;
  validated_by: string | null;
  validated_at: string | null;
  rejection_reason: string | null;
  n8n_execution_id: string | null;
  idempotency_key: string | null;
  duration_ms: number | null;
  tokens_used: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ── HITL (Human-in-the-Loop) ───────────────────────────────────────────────────
/** Données d'une interruption HITL : quel outil attend approbation */
export interface InterruptionData {
  tool_name: string;
  tool_input: Record<string, unknown>;
  description: string;
  risk_level: RiskLevel;
}

/** Snapshot du RunState sérialisé pour reprise après validation */
export interface RunStatePayload {
  serialized: string;   // JSON.stringify(runState) depuis @openai/agents
  created_at: string;
  agent_name: string;
}

// ── Auth ───────────────────────────────────────────────────────────────────────
export interface AuthContext {
  userId: string;
  email: string | null;
  cityId: string;           // obligatoire — vérifié côté serveur
  role: UserRole;
  channel: RequestChannel;
}

// ── API I/O ────────────────────────────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

// Chat
export interface ChatRequest {
  message: string;
  city_id: string;
  conversation_id?: string;
  channel: RequestChannel;
}

export interface ChatResponse {
  reply: string;
  conversation_id: string;
  message_id: string;
  pending_validation: boolean;          // calculé depuis interruptions réelles
  action_log_id?: string;
  interruption?: InterruptionData;
}

// Validate action
export interface ValidateActionRequest {
  action_log_id: string;
  decision: 'approved' | 'rejected';
  rejection_reason?: string;
}

export interface ValidateActionResponse {
  action_log_id: string;
  new_status: ActionStatus;
  n8n_triggered: boolean;
}

// n8n inbound webhook
export interface N8nWebhookRequest {
  action_log_id?: string;
  n8n_execution_id?: string;
  city_id: string;
  status: 'completed' | 'failed' | 'running';
  workflow?: string;
  result?: Record<string, unknown>;
  error_message?: string;
  entity_id?: string;
  entity_type?: string;
  idempotency_key: string;   // obligatoire pour anti-rejeu
  timestamp: string;         // ISO, pour TTL check
}

// n8n trigger
export interface N8nTriggerResult {
  success: boolean;
  n8n_execution_id: string | null;
  error?: string;
}
