'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'ACTIVE' | 'INACTIVE';
  lastLogin?: string;
}

const MOCK_USERS: User[] = [
  { id: 'u1', name: 'Marcus Johnson', email: 'marcus@golfingarage.com', role: 'technician', status: 'ACTIVE', lastLogin: '2026-03-10T08:00:00Z' },
  { id: 'u2', name: 'Sarah Kim', email: 'sarah@golfingarage.com', role: 'technician', status: 'ACTIVE', lastLogin: '2026-03-10T07:30:00Z' },
  { id: 'u3', name: 'James Carter', email: 'james@golfingarage.com', role: 'manager', status: 'ACTIVE', lastLogin: '2026-03-10T09:00:00Z' },
  { id: 'u4', name: 'Lisa Park', email: 'lisa@golfingarage.com', role: 'accounting', status: 'ACTIVE', lastLogin: '2026-03-09T16:00:00Z' },
  { id: 'u5', name: 'Tom Reed', email: 'tom@golfingarage.com', role: 'parts', status: 'INACTIVE' },
];

const ROLE_CLASSES: Record<string, string> = {
  technician: 'bg-blue-100 text-blue-800',
  manager:    'bg-purple-100 text-purple-800',
  accounting: 'bg-green-100 text-green-800',
  parts:      'bg-yellow-100 text-yellow-800',
  trainer:    'bg-pink-100 text-pink-800',
  admin:      'bg-red-100 text-red-800',
};

export default function UserAccessPage() {
  const [users] = useState(MOCK_USERS);

  return (
    <div>
      <PageHeader
        title="User Access"
        description="Manage roles and permissions"
        action={
          <Button className="bg-yellow-400 hover:bg-yellow-300 text-gray-900" onClick={() => toast.info('Invite user (coming soon)')}>
            + Invite User
          </Button>
        }
      />
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Role</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Last Login</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${ROLE_CLASSES[u.role] ?? 'bg-gray-100 text-gray-600'}`}>{u.role}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{u.status}</span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">{u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'Never'}</td>
                <td className="px-4 py-3">
                  <Button size="sm" variant="outline" onClick={() => toast.info(`Edit ${u.name} (coming soon)`)}>Edit</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
