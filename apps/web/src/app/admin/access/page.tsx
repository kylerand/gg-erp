'use client';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, mutationHeaders } from '@/lib/api-client';

interface CognitoUser {
  username: string;
  email: string;
  name?: string;
  status: string;
  enabled: boolean;
  groups: string[];
  createdAt: string;
}

const ROLES = [
  { value: 'admin', label: 'Admin', color: 'bg-red-100 text-red-800' },
  { value: 'shop_manager', label: 'Shop Manager', color: 'bg-purple-100 text-purple-800' },
  { value: 'technician', label: 'Technician', color: 'bg-blue-100 text-blue-800' },
  { value: 'parts_manager', label: 'Parts Manager', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'sales', label: 'Sales', color: 'bg-teal-100 text-teal-800' },
  { value: 'accounting', label: 'Accounting', color: 'bg-green-100 text-green-800' },
  { value: 'trainer_ojt_lead', label: 'Trainer / OJT Lead', color: 'bg-pink-100 text-pink-800' },
  { value: 'read_only_executive', label: 'Read-Only Executive', color: 'bg-gray-200 text-gray-700' },
] as const;

function roleBadge(group: string) {
  const r = ROLES.find((x) => x.value === group);
  return r ? (
    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${r.color}`}>{r.label}</span>
  ) : (
    <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">
      {group}
    </span>
  );
}

export default function UserAccessPage() {
  const [users, setUsers] = useState<CognitoUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUser, setEditUser] = useState<CognitoUser | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const data = await apiFetch<{ users: CognitoUser[] }>('/admin/users');
      setUsers(data.users);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  return (
    <div>
      <PageHeader
        title="User Access"
        description="Manage team members and their roles"
        action={
          <Button
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900"
            onClick={() => setInviteOpen(true)}
          >
            + Invite User
          </Button>
        }
      />

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Role</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading &&
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-24" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No users found. Invite your first team member!
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.username} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-900 font-medium">{u.email}</td>
                <td className="px-4 py-3 text-gray-500">{u.name ?? '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.groups.length > 0
                      ? u.groups.map((g) => <span key={g}>{roleBadge(g)}</span>)
                      : <span className="text-xs text-gray-400 italic">No role</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      u.enabled
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {u.enabled ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditUser(u)}
                  >
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <InviteUserDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={() => {
          setInviteOpen(false);
          void fetchUsers();
        }}
      />

      {editUser && (
        <EditUserDialog
          user={editUser}
          onClose={() => setEditUser(null)}
          onUpdated={() => {
            setEditUser(null);
            void fetchUsers();
          }}
        />
      )}
    </div>
  );
}

/* ─── Invite User Dialog ───────────────────────────────────────────────────── */

function InviteUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('technician');
  const [tempPassword, setTempPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setEmail('');
    setName('');
    setRole('technician');
    setTempPassword('');
  }

  async function handleInvite() {
    if (!email) {
      toast.error('Email is required');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email, name: name || undefined, role, temporaryPassword: tempPassword || undefined }),
        ...mutationHeaders(),
      });
      toast.success(`Invited ${email}`);
      reset();
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to invite user');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
          <DialogDescription>
            They'll receive a temporary password and must reset it on first login.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="invite-email">Email *</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@golfingarage.com"
            />
          </div>
          <div>
            <Label htmlFor="invite-name">Full Name</Label>
            <Input
              id="invite-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
            />
          </div>
          <div>
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(v) => v && setRole(v)}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="invite-password">Temporary Password (optional)</Label>
            <Input
              id="invite-password"
              type="password"
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
              placeholder="Auto-generated if empty"
            />
            <p className="text-xs text-gray-400 mt-1">
              Min 12 chars, upper + lower + number + symbol
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900"
            onClick={handleInvite}
            disabled={submitting}
          >
            {submitting ? 'Inviting…' : 'Invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Edit User Dialog ─────────────────────────────────────────────────────── */

function EditUserDialog({
  user,
  onClose,
  onUpdated,
}: {
  user: CognitoUser;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [role, setRole] = useState(user.groups[0] ?? 'technician');
  const [enabled, setEnabled] = useState(user.enabled);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleSave() {
    setSubmitting(true);
    try {
      await apiFetch(`/admin/users/${encodeURIComponent(user.username)}`, {
        method: 'PATCH',
        body: JSON.stringify({ role, enabled }),
        ...mutationHeaders(),
      });
      toast.success(`Updated ${user.email}`);
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    setSubmitting(true);
    try {
      await apiFetch(`/admin/users/${encodeURIComponent(user.username)}`, {
        method: 'DELETE',
        ...mutationHeaders(),
      });
      toast.success(`Deleted ${user.email}`);
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setSubmitting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="edit-role">Role</Label>
            <Select value={role} onValueChange={(v) => v && setRole(v)}>
              <SelectTrigger id="edit-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="edit-enabled">Account Enabled</Label>
            <button
              id="edit-enabled"
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled(!enabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                enabled ? 'bg-green-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
        <DialogFooter className="flex justify-between sm:justify-between">
          {!confirmDelete ? (
            <Button
              variant="outline"
              className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
              onClick={() => setConfirmDelete(true)}
            >
              Delete User
            </Button>
          ) : (
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDelete}
              disabled={submitting}
            >
              Confirm Delete
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="bg-yellow-400 hover:bg-yellow-300 text-gray-900"
              onClick={handleSave}
              disabled={submitting}
            >
              {submitting ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
