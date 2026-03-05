'use client';

import { useState, useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export default function UserHeader() {
  const [displayName, setDisplayName] = useState('');
  const [initial, setInitial] = useState('');

  useEffect(() => {
    const userId = localStorage.getItem('userId') || 'default-user';
    const tenantId = 'default-tenant';

    fetch(`${API_BASE}/dashboard/overview?tenantId=${tenantId}&userId=${userId}`)
      .then((res) => res.json())
      .then((data) => {
        setDisplayName(data.user?.displayName || userId);
        setInitial(data.user?.initial || userId.charAt(0).toUpperCase());
      })
      .catch(() => {
        setDisplayName(userId);
        setInitial(userId.charAt(0).toUpperCase());
      });
  }, []);

  return (
    <div className="flex items-center space-x-2">
      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
        <span className="text-blue-600 text-sm">{initial}</span>
      </div>
      <span className="text-gray-700">{displayName || '加载中...'}</span>
    </div>
  );
}
