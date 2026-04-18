'use client';

import { useState } from 'react';

interface Collaborator {
  id: string;
  role: string;
  user: { id: string; email: string; name: string | null };
}

interface CollaboratorsPanelProps {
  routeId: string;
  ownerId: string;
  currentUserId: string;
  collaborators: Collaborator[];
  onUpdate: (collabs: Collaborator[]) => void;
}

export default function CollaboratorsPanel({
  routeId,
  ownerId,
  currentUserId,
  collaborators,
  onUpdate,
}: CollaboratorsPanelProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'VIEWER' | 'EDITOR'>('VIEWER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isOwner = currentUserId === ownerId;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    const res = await fetch(`/api/routes/${routeId}/collaborators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error); return; }
    setSuccess(`${email} toegevoegd!`);
    setEmail('');
    // Reload collaborators
    const routeRes = await fetch(`/api/routes/${routeId}`);
    const routeData = await routeRes.json();
    onUpdate(routeData.collaborators);
  };

  const handleRemove = async (userId: string) => {
    await fetch(`/api/routes/${routeId}/collaborators`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const routeRes = await fetch(`/api/routes/${routeId}`);
    const routeData = await routeRes.json();
    onUpdate(routeData.collaborators);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Medewerkers
      </h3>

      {collaborators.length === 0 && (
        <p className="text-xs text-gray-400 italic">Nog niemand uitgenodigd.</p>
      )}

      <ul className="space-y-2">
        {collaborators.map((c) => (
          <li key={c.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1 truncate text-gray-700">
              {c.user.name || c.user.email}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              c.role === 'EDITOR'
                ? 'bg-brand-100 text-brand-700'
                : 'bg-gray-100 text-gray-500'
            }`}>
              {c.role === 'EDITOR' ? 'Bewerker' : 'Kijker'}
            </span>
            {(isOwner || c.user.id === currentUserId) && (
              <button
                onClick={() => handleRemove(c.user.id)}
                className="text-red-400 hover:text-red-600 text-xs transition-colors"
                title="Verwijderen"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <form onSubmit={handleInvite} className="space-y-2 pt-2 border-t border-gray-100">
          <input
            type="email"
            required
            placeholder="E-mail uitnodigen…"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <div className="flex gap-2">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'VIEWER' | 'EDITOR')}
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="VIEWER">Kijker</option>
              <option value="EDITOR">Bewerker</option>
            </select>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Bezig…' : 'Uitnodigen'}
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {success && <p className="text-xs text-green-600">{success}</p>}
        </form>
      )}
    </div>
  );
}
