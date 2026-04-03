-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "sales";

-- CreateEnum
CREATE TYPE "sales"."SalesOpportunityStage" AS ENUM ('PROSPECT', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST');

-- CreateEnum
CREATE TYPE "sales"."LeadSource" AS ENUM ('WALK_IN', 'REFERRAL', 'WEBSITE', 'PHONE', 'EVENT', 'OTHER');

-- CreateEnum
CREATE TYPE "sales"."QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "sales"."SalesActivityType" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'MEETING', 'QUOTE_SENT', 'FOLLOW_UP', 'STAGE_CHANGE');

-- AlterEnum
ALTER TYPE "migration"."ImportEntityType" ADD VALUE 'PURCHASE_ORDER';

-- CreateTable
CREATE TABLE "sales"."sales_opportunities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "stage" "sales"."SalesOpportunityStage" NOT NULL DEFAULT 'PROSPECT',
    "probability" INTEGER NOT NULL DEFAULT 10,
    "estimated_value" DECIMAL(14,2),
    "expected_close_date" DATE,
    "assigned_to_user_id" UUID,
    "source" "sales"."LeadSource" NOT NULL DEFAULT 'OTHER',
    "lost_reason" TEXT,
    "won_work_order_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales"."quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_number" TEXT NOT NULL,
    "opportunity_id" UUID,
    "customer_id" UUID NOT NULL,
    "status" "sales"."QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "valid_until" DATE,
    "notes" TEXT,
    "terms_and_conditions" TEXT,
    "created_by_user_id" UUID,
    "approved_by_user_id" UUID,
    "converted_wo_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales"."quote_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "part_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales"."sales_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "opportunity_id" UUID,
    "customer_id" UUID,
    "activity_type" "sales"."SalesActivityType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "due_date" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales"."lead_scores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "factors" JSONB NOT NULL DEFAULT '{}',
    "scored_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model_version" TEXT NOT NULL DEFAULT 'v1',

    CONSTRAINT "lead_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales"."agent_chat_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales"."agent_chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_opportunities_customer_idx" ON "sales"."sales_opportunities"("customer_id");

-- CreateIndex
CREATE INDEX "sales_opportunities_stage_idx" ON "sales"."sales_opportunities"("stage");

-- CreateIndex
CREATE INDEX "sales_opportunities_assignee_idx" ON "sales"."sales_opportunities"("assigned_to_user_id");

-- CreateIndex
CREATE INDEX "sales_opportunities_created_idx" ON "sales"."sales_opportunities"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_quote_number_key" ON "sales"."quotes"("quote_number");

-- CreateIndex
CREATE INDEX "quotes_customer_idx" ON "sales"."quotes"("customer_id");

-- CreateIndex
CREATE INDEX "quotes_opportunity_idx" ON "sales"."quotes"("opportunity_id");

-- CreateIndex
CREATE INDEX "quotes_status_idx" ON "sales"."quotes"("status");

-- CreateIndex
CREATE INDEX "quotes_created_idx" ON "sales"."quotes"("created_at");

-- CreateIndex
CREATE INDEX "quote_lines_quote_idx" ON "sales"."quote_lines"("quote_id");

-- CreateIndex
CREATE INDEX "sales_activities_opportunity_idx" ON "sales"."sales_activities"("opportunity_id");

-- CreateIndex
CREATE INDEX "sales_activities_customer_idx" ON "sales"."sales_activities"("customer_id");

-- CreateIndex
CREATE INDEX "sales_activities_created_idx" ON "sales"."sales_activities"("created_at");

-- CreateIndex
CREATE INDEX "lead_scores_customer_idx" ON "sales"."lead_scores"("customer_id");

-- CreateIndex
CREATE INDEX "lead_scores_scored_idx" ON "sales"."lead_scores"("scored_at");

-- CreateIndex
CREATE INDEX "agent_chat_sessions_user_idx" ON "sales"."agent_chat_sessions"("user_id");

-- CreateIndex
CREATE INDEX "agent_chat_sessions_last_msg_idx" ON "sales"."agent_chat_sessions"("last_message_at");

-- CreateIndex
CREATE INDEX "agent_chat_messages_session_idx" ON "sales"."agent_chat_messages"("session_id", "created_at");

-- AddForeignKey
ALTER TABLE "sales"."quotes" ADD CONSTRAINT "quotes_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "sales"."sales_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales"."quote_lines" ADD CONSTRAINT "quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "sales"."quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales"."sales_activities" ADD CONSTRAINT "sales_activities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "sales"."sales_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales"."agent_chat_messages" ADD CONSTRAINT "agent_chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sales"."agent_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
