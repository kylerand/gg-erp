-- DropForeignKey
ALTER TABLE "tickets"."step_evidence_attachments" DROP CONSTRAINT "step_evidence_attachments_file_attachment_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets"."step_evidence_attachments" DROP CONSTRAINT "step_evidence_attachments_routing_step_id_fkey";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "labor_entries_task_idx" ON "tickets"."labor_time_entries"("technician_task_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "qc_gates_task_idx" ON "work_orders"."work_order_qc_gates"("task_id");

-- AddForeignKey
ALTER TABLE "tickets"."step_evidence_attachments" ADD CONSTRAINT "step_evidence_attachments_routing_step_id_fkey" FOREIGN KEY ("routing_step_id") REFERENCES "planning"."routing_sop_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets"."step_evidence_attachments" ADD CONSTRAINT "step_evidence_attachments_file_attachment_id_fkey" FOREIGN KEY ("file_attachment_id") REFERENCES "tickets"."file_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets"."labor_time_entries" ADD CONSTRAINT "labor_time_entries_technician_task_id_fkey" FOREIGN KEY ("technician_task_id") REFERENCES "tickets"."technician_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders"."work_order_qc_gates" ADD CONSTRAINT "work_order_qc_gates_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"."work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
