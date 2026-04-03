export enum SalesOpportunityStage {
  PROSPECT = 'PROSPECT',
  QUALIFIED = 'QUALIFIED',
  PROPOSAL = 'PROPOSAL',
  NEGOTIATION = 'NEGOTIATION',
  CLOSED_WON = 'CLOSED_WON',
  CLOSED_LOST = 'CLOSED_LOST',
}

export const STAGE_PROBABILITY: Record<SalesOpportunityStage, number> = {
  [SalesOpportunityStage.PROSPECT]: 10,
  [SalesOpportunityStage.QUALIFIED]: 25,
  [SalesOpportunityStage.PROPOSAL]: 50,
  [SalesOpportunityStage.NEGOTIATION]: 75,
  [SalesOpportunityStage.CLOSED_WON]: 100,
  [SalesOpportunityStage.CLOSED_LOST]: 0,
};

export enum QuoteStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  CONVERTED = 'CONVERTED',
}

export enum SalesActivityType {
  NOTE = 'NOTE',
  CALL = 'CALL',
  EMAIL = 'EMAIL',
  MEETING = 'MEETING',
  QUOTE_SENT = 'QUOTE_SENT',
  FOLLOW_UP = 'FOLLOW_UP',
  STAGE_CHANGE = 'STAGE_CHANGE',
}

export enum LeadSource {
  WALK_IN = 'WALK_IN',
  REFERRAL = 'REFERRAL',
  WEBSITE = 'WEBSITE',
  PHONE = 'PHONE',
  EVENT = 'EVENT',
  OTHER = 'OTHER',
}

export interface SalesOpportunity {
  id: string;
  customerId: string;
  title: string;
  description?: string;
  stage: SalesOpportunityStage;
  probability: number;
  estimatedValue?: string;
  expectedCloseDate?: string;
  assignedToUserId?: string;
  source: LeadSource;
  lostReason?: string;
  wonWorkOrderId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  opportunityId?: string;
  customerId: string;
  status: QuoteStatus;
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  validUntil?: string;
  notes?: string;
  termsAndConditions?: string;
  createdByUserId?: string;
  approvedByUserId?: string;
  convertedWoId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  lines?: QuoteLine[];
}

export interface QuoteLine {
  id: string;
  quoteId: string;
  partId?: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  lineTotal: string;
  sortOrder: number;
}

export interface SalesActivity {
  id: string;
  opportunityId?: string;
  customerId?: string;
  activityType: SalesActivityType;
  subject: string;
  body?: string;
  dueDate?: string;
  completedAt?: string;
  createdByUserId?: string;
  createdAt: string;
}

export interface LeadScore {
  id: string;
  customerId: string;
  score: number;
  factors: Record<string, unknown>;
  scoredAt: string;
  modelVersion: string;
}

export interface PipelineStats {
  totalOpportunities: number;
  totalValue: string;
  weightedForecast: string;
  avgDealSize: string;
  winRate: number;
  byStage: Array<{
    stage: SalesOpportunityStage;
    count: number;
    value: string;
  }>;
}

export interface SalesForecast {
  month: string;
  weightedValue: string;
  dealCount: number;
  byStage: Array<{
    stage: SalesOpportunityStage;
    value: string;
    count: number;
  }>;
}
