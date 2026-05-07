'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { PageHeader } from '@gg-erp/ui';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { listMyAssignments, type TrainingAssignment } from '@/lib/api-client';
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

function matchesSearch(a: TrainingAssignment, search: string): boolean {
  if (!search.trim()) return true;
  const haystack = [
    a.employeeId,
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
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState(activeSearch);

  useEffect(() => {
    setSearchText(activeSearch);
  }, [activeSearch]);

  useEffect(() => {
    listMyAssignments('', {}, { allowMockFallback: false })
      .then((res) => setAssignments(res.items))
      .catch(() => toast.error('Failed to load assignments'))
      .finally(() => setLoading(false));
  }, []);

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
        if (!matchesSearch(assignment, activeSearch)) return false;
        if (activeStatus === 'OVERDUE') return isOverdue(assignment);
        if (activeStatus === 'ALL') return true;
        return assignment.assignmentStatus === activeStatus;
      }),
    [activeSearch, activeStatus, assignments],
  );

  function applySearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(buildAssignmentsHref(activeStatus, searchText));
  }

  return (
    <div>
      <PageHeader
        title="Team Assignments"
        description={`Track training progress across your team - ${filteredAssignments.length} of ${assignments.length} shown`}
      />

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
            return (
              <Card
                key={assignment.id}
                className={overdue ? 'border-red-200 bg-red-50/30' : undefined}
              >
                <CardContent className="pt-3 pb-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{assignment.employeeId}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {assignment.module?.moduleName ?? assignment.moduleId}
                        {assignment.dueAt
                          ? ` - Due ${new Date(assignment.dueAt).toLocaleDateString()}`
                          : ''}
                      </p>
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
