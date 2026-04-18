'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface AuthUser { id: string; email: string; name: string | null; }

export default function Navbar() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setUser);
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    router.push('/login');
  };

  if (user === undefined) return null; // nog laden

  return (
    <nav className="absolute top-3 right-4 z-[1000] flex items-center gap-2">
      {user ? (
        <>
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 bg-white/90 backdrop-blur border border-gray-200 rounded-full px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-brand-300 shadow-sm transition-colors"
          >
            📋 <span className="hidden sm:inline">{user.name || user.email}</span>
          </Link>
          <button
            onClick={handleLogout}
            className="bg-white/90 backdrop-blur border border-gray-200 rounded-full px-3 py-1.5 text-sm text-gray-500 hover:text-red-500 hover:border-red-200 shadow-sm transition-colors"
          >
            Uitloggen
          </button>
        </>
      ) : (
        <Link
          href="/login"
          className="bg-brand-500 hover:bg-brand-600 text-white rounded-full px-4 py-1.5 text-sm font-medium shadow-sm transition-colors"
        >
          Inloggen
        </Link>
      )}
    </nav>
  );
}
