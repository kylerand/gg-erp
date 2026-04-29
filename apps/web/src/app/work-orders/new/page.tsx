'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createWorkOrder } from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';
import { PageHeader } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function NewWorkOrderPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const scheduledDate = form.get('scheduledDate') as string;
    try {
      await createWorkOrder({
        workOrderNumber: form.get('workOrderNumber') as string,
        vehicleId: form.get('vehicleId') as string,
        customerId: (form.get('customerId') as string) || undefined,
        buildConfigurationId: form.get('buildConfigurationId') as string,
        bomId: form.get('bomId') as string,
        description: (form.get('description') as string) || undefined,
        scheduledDate: scheduledDate ? new Date(scheduledDate).toISOString() : undefined,
      });
      toast.success('Work order created');
      router.push(erpRoute('work-order'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create work order');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="New Work Order" />
      <Card>
        <CardHeader>
          <CardTitle>Work Order Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="workOrderNumber">
                  Work Order # <span className="text-red-500">*</span>
                </Label>
                <Input id="workOrderNumber" name="workOrderNumber" required placeholder="WO-001" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vehicleId">
                  Vehicle ID <span className="text-red-500">*</span>
                </Label>
                <Input id="vehicleId" name="vehicleId" required placeholder="v-001" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="buildConfigurationId">
                  Build Config ID <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="buildConfigurationId"
                  name="buildConfigurationId"
                  required
                  placeholder="bc-001"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bomId">
                  BOM ID <span className="text-red-500">*</span>
                </Label>
                <Input id="bomId" name="bomId" required placeholder="bom-001" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customerId">Customer ID</Label>
              <Input id="customerId" name="customerId" placeholder="c-001 (optional)" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scheduledDate">Scheduled Date</Label>
              <Input id="scheduledDate" name="scheduledDate" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                rows={3}
                placeholder="Describe the work to be done…"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                disabled={loading}
                className="bg-yellow-400 hover:bg-yellow-300 text-gray-900"
              >
                {loading ? 'Creating…' : 'Create Work Order'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(erpRoute('work-order'))}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
