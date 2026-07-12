import { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api/v1';

export const useApi = () => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any | null>(null);
  const [loadingUser, setLoadingUser] = useState<boolean>(true);

  // Sync token from localStorage on load
  useEffect(() => {
    const savedToken = localStorage.getItem('anime_studio_token');
    const savedUser = localStorage.getItem('anime_studio_user');
    if (savedToken) {
      setToken(savedToken);
    }
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setLoadingUser(false);
  }, []);

  const login = async (username: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Login failed');
    }
    const data = await res.json();
    localStorage.setItem('anime_studio_token', data.access_token);
    localStorage.setItem('anime_studio_user', JSON.stringify(data.user));
    setToken(data.access_token);
    setUser(data.user);
    return data;
  };

  const register = async (email: string, username: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Registration failed');
    }
    const data = await res.json();
    localStorage.setItem('anime_studio_token', data.access_token);
    localStorage.setItem('anime_studio_user', JSON.stringify(data.user));
    setToken(data.access_token);
    setUser(data.user);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('anime_studio_token');
    localStorage.removeItem('anime_studio_user');
    setToken(null);
    setUser(null);
  };

  const getAuthHeaders = useCallback(() => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }, [token]);

  const fetchStyles = useCallback(async () => {
    const res = await fetch(`${API_BASE}/styles`);
    if (!res.ok) throw new Error("Failed to load styles");
    return res.json();
  }, []);

  const fetchBackgrounds = useCallback(async () => {
    const res = await fetch(`${API_BASE}/background`);
    if (!res.ok) throw new Error("Failed to load backgrounds");
    return res.json();
  }, []);

  const submitGeneration = useCallback(async (photoId: string, style: string, background: string) => {
    const res = await fetch(`${API_BASE}/generate`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ photo_id: photoId, style, background })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to submit generation task');
    }
    return res.json();
  }, [getAuthHeaders]);

  const pollTaskStatus = useCallback(async (taskId: string) => {
    const res = await fetch(`${API_BASE}/generate/status/${taskId}`);
    if (!res.ok) throw new Error("Failed to retrieve task status");
    return res.json();
  }, []);

  const triggerUpscale = useCallback(async (photoId: string, factor: number = 2) => {
    const res = await fetch(`${API_BASE}/upscale`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ photo_id: photoId, upscale_factor: factor })
    });
    if (!res.ok) throw new Error("Upscaling failed");
    return res.json();
  }, [getAuthHeaders]);

  const triggerPrint = useCallback(async (photoId: string) => {
    const res = await fetch(`${API_BASE}/print/${photoId}`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("Printing failed");
    return res.json();
  }, [getAuthHeaders]);

  const fetchGallery = useCallback(async () => {
    const res = await fetch(`${API_BASE}/gallery`);
    if (!res.ok) throw new Error("Failed to fetch gallery");
    return res.json();
  }, []);

  const fetchHistory = useCallback(async () => {
    const res = await fetch(`${API_BASE}/history`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("Failed to fetch history");
    return res.json();
  }, [getAuthHeaders]);

  const fetchAdminAnalytics = useCallback(async () => {
    const res = await fetch(`${API_BASE}/admin/analytics`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Unauthorized admin query");
    }
    return res.json();
  }, [getAuthHeaders]);

  const uploadManualCapture = useCallback(async (file: File, style: string, background: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('style', style);
    formData.append('background', background);
    if (user?.id) {
      formData.append('user_id', user.id);
    }
    
    // We override content type to let browser handle multipart boundary boundaries
    const headers = getAuthHeaders();
    delete headers['Content-Type'];

    const res = await fetch(`${API_BASE}/capture`, {
      method: 'POST',
      headers,
      body: formData
    });
    if (!res.ok) throw new Error("Manual image capture upload failed");
    return res.json();
  }, [getAuthHeaders, user]);

  return {
    user,
    token,
    loadingUser,
    login,
    register,
    logout,
    fetchStyles,
    fetchBackgrounds,
    submitGeneration,
    pollTaskStatus,
    triggerUpscale,
    triggerPrint,
    fetchGallery,
    fetchHistory,
    fetchAdminAnalytics,
    uploadManualCapture
  };
};
