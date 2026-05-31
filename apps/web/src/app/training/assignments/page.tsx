'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@gg-erp/ui';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  createTrainingAssignments,
  listEmployees,
  listMyAssignments,
  listTrainingModules,
  type Employee,
  type TrainingAssignment,
  type TrainingModule,
} from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';

type AssignmentFilter = TrainingAssignment['assignmentStatus'] | 'OVERDUE' | 'ALL';

const ASSIGNMENT_FILTERS: Array<{ label: string; value: AssignmentFilter }> = [
  { label: 'All', value: 'ALL' },
  { label: 'Overdue', value: 'OVERDUE' },
  { label: 'Assigned', value: 'ASSIGNED' },
  { label: 'In Progress', value: 'IN_PROGRESS' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Failed', value: 'FAILED' },
];

const STATUS_CLASSES: Record<string, string> = {
  COMPLETED: 'bg-green-100 text-green-800',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
  ASSIGNED: 'bg-gray-100 text-gray-600',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-400',
  EXEMPT: 'bg-blue-50 text-blue-600',
};

function parseAssignmentFilter(value: string | null): AssignmentFilter {
  return ASSIGNMENT_FILTERS.some((filter) => filter.value === value)
    ? (value as AssignmentFilter)
    : 'ALL';
}

function isOverdue(a: TrainingAssignment): boolean {
  return (
    !['COMPLETED', 'CANCELLED', 'EXEMPT'].includes(a.assignmentStatus) &&
    !!a.dueAt &&
    new Date(a.dueAt) < new Date()
  );
}

function formatEmployeeName(employee: Employee | undefined): string | undefined {
  if (!employee) return undefined;
  return [employee.firstName, employee.lastName].filter(Boolean).join(' ').trim() || employee.employeeNumber;
}

function matchesSearch(
  a: TrainingAssignment,
  search: string,
  employeeById: Map<string, Employee>,
): boolean {
  if (!search.trim()) return true;
  const employee = employeeById.get(a.employeeId);
  const haystack = [
    formatEmployeeName(employee),
    employee?.employeeNumber,
    employee?.employmentState,
    a.moduleId,
    a.module?.moduleCode,
    a.module?.moduleName,
    a.module?.sopDocument?.documentCode,
    a.module?.sopDocument?.title,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(search.trim().toLowerCase());
}

function buildAssignmentsHref(status: AssignmentFilter, search: string): string {
  const params = new URLSearchParams();
  if (status !== 'ALL') params.set('status', status);
  if (search.trim()) params.set('search', search.trim());
  const qs = params.toString();
  return `${erpRoute('training-assignment')}${qs ? `?${qs}` : ''}`;
}

export default function AssignmentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeStatus = parseAssignmentFilter(searchParams.get('status'));
  const activeSearch = searchParams.get('search') ?? '';
  const [assignments, setAssignments] = useState<TrainingAssignment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [employeeLookupFailed, setEmployeeLookupFailed] = useState(false);
  const [moduleLookupFailed, setModuleLookupFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchText, setSearchText] = useState(activeSearch);
  const [selectedModuleId, setSelectedModuleId] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [dueDate, setDueDate] = useState('');

  useEffect(() => {
    setSearchText(activeSearch);
  }, [activeSearch]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEmployeeLookupFailed(false);
    setModuleLookupFailed(false);

    Promise.allSettled([
      listMyAssignments('', {}, { allowMockFallback: false }),
      listEmployees(undefined, { allowMockFallback: false }),
      listTrainingModules({ status: 'ACTIVE' }, { allowMockFallback: false }),
    ]).then(([assignmentResult, employeeResult, moduleResult]) => {
      if (cancelled) return;

      if (assignmentResult.status === 'fulfilled') {
        setAssignments(assignmentResult.value.items);
      } else {
        setAssignments([]);
        toast.error('Failed to load assignments');
      }

      if (employeeResult.status === 'fulfilled') {
        setEmployees(employeeResult.value.items);
        setSelectedEmployeeId((current) => current || employeeResult.value.items[0]?.id || '');
      } else {
        setEmployees([]);
        setEmployeeLookupFailed(true);
        toast.error('Failed to load employee names');
      }

      if (moduleResult.status === 'fulfilled') {
        setModules(moduleResult.value.items);
        setSelectedModuleId((current) => current || moduleResult.value.items[0]?.id || '');
      } else {
        setModules([]);
        setModuleLookupFailed(true);
        toast.error('Failed to load training modules');
      }

      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const employeeById = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<AssignmentFilter, number> = {
      ALL: assignments.length,
      OVERDUE: assignments.filter(isOverdue).length,
      ASSIGNED: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      FAILED: 0,
      CANCELLED: 0,
      EXEMPT: 0,
    };
    for (const assignment of assignments) {
      if (assignment.assignmentStatus in counts) {
        counts[assignment.assignmentStatus as AssignmentFilter] += 1;
      }
    }
    return counts;
  }, [assignments]);

  const filteredAssignments = useMemo(
    () =>
      assignments.filter((assignment) => {
        if (!matchesSearch(assignment, activeSearch, employeeById)) return false;
        if (activeStatus === 'OVERDUE') return isOverdue(assignment);
        if (activeStatus === 'ALL') return true;
        return assignment.assignmentStatus === activeStatus;
      }),
    [activeSearch, activeStatus, assignments, employeeById],
  );

  function applySearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(buildAssignmentsHref(activeStatus, searchText));
  }

  async function assignModule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedModuleId) {
      toast.error('Select a training module');
      return;
    }
    if (!selectedEmployeeId) {
      toast.error('Select an employee');
      return;
    }

    setSubmitting(true);
    try {
      const dueAt = dueDate ? new Date(`${dueDate}T23:59:59.000Z`).toISOString() : undefined;
      const result = await createTrainingAssignments(
        { moduleId: selectedModuleId, employeeIds: [selectedEmployeeId], dueAt },
        { allowMockFallback: false },
      );
      if (result.items.length > 0) {
        setAssignments((current) => [
          ...result.items,
          ...current.filter((assignment) => !result.items.some((item) => item.id === assignment.id)),
        ]);
        toast.success(`Assigned ${result.items.length} module${result.items.length === 1 ? '' : 's'}`);
      } else if (result.totalSkipped > 0) {
        toast.success('That employee already has an active assignment for this module');
      }
      setSelectedEmployeeId('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to assign module');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Team Assignments"
        description={`Track training progress across your team - ${filteredAssignments.length} of ${assignments.length} shown`}
      />

      <Card className="mb-4 border-[#F4C542]/60 bg-[#FFFDF7]">
        <CardContent className="p-4">
          <form onSubmit={assignModule} className="grid gap-3 lg:grid-cols-[1.2fr_1.2fr_0.8fr_auto] lg:items-end">
            <label className="grid gap-1.5 text-xs font-semibold text-gray-600">
              Module
              <select
                value={selectedModuleId}
                onChange={(event) => setSelectedModuleId(event.target.value)}
                disabled={submitting || modules.length === 0}
                className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-100"
              >
                <option value="">Select module</option>
                {modules.map((module) => (
                  <option key={module.id} value={module.id}>
                    {module.moduleCode} - {module.moduleName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-gray-600">
              Employee
              <select
                value={selectedEmployeeId}
                onChange={(event) => setSelectedEmployeeId(event.target.value)}
                disabled={submitting || employees.length === 0}
                className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-100"
              >
                <option value="">Select employee</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {formatEmployeeName(employee) ?? employee.id}
                    {employee.employeeNumber ? ` - ${employee.employeeNumber}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-gray-600">
              Due Date
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                disabled={submitting}
                className="h-9 bg-white"
              />
            </label>
            <Button
              type="submit"
              disabled={submitting || modules.length === 0 || employees.length === 0}
              className="h-9 bg-[#E37125] text-white hover:bg-[#c95f1d]"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              Assign Module
            </Button>
          </form>
          {(employeeLookupFailed || moduleLookupFailed) && (
            <p className="mt-3 text-xs text-red-600">
              {employeeLookupFailed ? 'Employee registry failed to load. ' : ''}
              {moduleLookupFailed ? 'Training modules failed to load.' : ''}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {ASSIGNMENT_FILTERS.map((filter) => {
            const active = activeStatus === filter.value;
            return (
              <Link
                key={filter.value}
                href={buildAssignmentsHref(filter.value, activeSearch)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-[#E37125] bg-[#FFF3E8] text-[#8A4A18]'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-yellow-400'
                }`}
              >
                {filter.label} ({statusCounts[filter.value] ?? 0})
              </Link>
            );
          })}
        </div>
        <form onSubmit={applySearch} className="flex w-full gap-2 lg:max-w-md">
          <Input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search employee, module, SOP..."
            className="h-9"
          />
          <Button type="submit" className="h-9 bg-yellow-400 text-gray-900 hover:bg-yellow-300">
            Search
          </Button>
          {(activeSearch || activeStatus !== 'ALL') && (
            <Link
              href={erpRoute('training-assignment')}
              className="inline-flex h-9 items-center rounded-md border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 hover:border-yellow-400"
            >
              Reset
            </Link>
          )}
        </form>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : filteredAssignments.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-1">No assignments found</p>
          <p className="text-sm">Adjust the filters or assign modules to team members.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredAssignments.map((assignment) => {
            const overdue = isOverdue(assignment);
            const employee = employeeById.get(assignment.employeeId);
            const employeeName = formatEmployeeName(employee) ?? 'Unresolved employee';
            return (
              <Card
                key={assignment.id}
                className={overdue ? 'border-red-200 bg-red-50/30' : undefined}
              >
                <CardContent className="pt-3 pb-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{employeeName}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {employee?.employeeNumber ? `${employee.employeeNumber} - ` : ''}
                        {assignment.module?.moduleName ?? assignment.moduleId}
                        {assignment.dueAt
                          ? ` - Due ${new Date(assignment.dueAt).toLocaleDateString()}`
                          : ''}
                      </p>
                      {!employee && employeeLookupFailed && (
                        <p className="text-xs text-red-600 mt-1">
                          Employee registry lookup failed. Retry after HR data is available.
                        </p>
                      )}
                    </div>
                    {assignment.score !== undefined && (
                      <span className="text-xs text-gray-500">Score: {assignment.score}</span>
                    )}
                    {overdue && (
                      <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                        Overdue
                      </span>
                    )}
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                        STATUS_CLASSES[assignment.assignmentStatus] ?? 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {assignment.assignmentStatus.replace('_', ' ')}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
