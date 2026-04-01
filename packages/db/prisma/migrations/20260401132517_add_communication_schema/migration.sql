-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "communication";

-- CreateEnum
CREATE TYPE "communication"."ChannelType" AS ENUM ('TEAM', 'WORK_ORDER', 'CUSTOMER', 'DIRECT');

-- CreateEnum
CREATE TYPE "communication"."ChannelMemberRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "communication"."ChannelTodoStatus" AS ENUM ('OPEN', 'DONE');

-- CreateTable
CREATE TABLE "communication"."channels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "type" "communication"."ChannelType" NOT NULL,
    "description" TEXT,
    "entity_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication"."channel_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channel_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "communication"."ChannelMemberRole" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_read_at" TIMESTAMPTZ(6),

    CONSTRAINT "channel_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication"."messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channel_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "parent_id" UUID,
    "edited_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication"."message_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "file_attachment_id" UUID NOT NULL,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication"."message_reactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication"."channel_todos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channel_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "communication"."ChannelTodoStatus" NOT NULL DEFAULT 'OPEN',
    "assignee_id" UUID,
    "due_date" DATE,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_todos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication"."notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channels_type_idx" ON "communication"."channels"("type");

-- CreateIndex
CREATE INDEX "channels_entity_idx" ON "communication"."channels"("entity_id");

-- CreateIndex
CREATE INDEX "channel_members_user_idx" ON "communication"."channel_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_members_unique" ON "communication"."channel_members"("channel_id", "user_id");

-- CreateIndex
CREATE INDEX "messages_channel_created_idx" ON "communication"."messages"("channel_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_parent_idx" ON "communication"."messages"("parent_id");

-- CreateIndex
CREATE INDEX "messages_author_idx" ON "communication"."messages"("author_id");

-- CreateIndex
CREATE INDEX "message_attachments_message_idx" ON "communication"."message_attachments"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_reactions_unique" ON "communication"."message_reactions"("message_id", "user_id", "emoji");

-- CreateIndex
CREATE INDEX "channel_todos_channel_status_idx" ON "communication"."channel_todos"("channel_id", "status");

-- CreateIndex
CREATE INDEX "notifications_user_read_idx" ON "communication"."notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_user_created_idx" ON "communication"."notifications"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "communication"."channel_members" ADD CONSTRAINT "channel_members_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "communication"."channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication"."messages" ADD CONSTRAINT "messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "communication"."channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication"."messages" ADD CONSTRAINT "messages_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "communication"."messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication"."message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "communication"."messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication"."message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "communication"."messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication"."channel_todos" ADD CONSTRAINT "channel_todos_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "communication"."channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
