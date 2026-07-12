import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useApi } from '../hooks/useApi';
import { AnalyticsPanel } from '../components/AnalyticsPanel';
import { GlassCard } from '../components/GlassCard';
import { ShieldAlert, RefreshCw, BarChart2 } from 'lucide-react';

export default function AdminPage() {
  const router = useRouter();
  const { user, token, loadingUser, fetchAdminAnalytics } = useApi();

  const [analytics, setAnalytics] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminAnalytics();
      setAnalytics(data);
    } catch (err: any) {
      setError(err.message || "Failed to load admin analytics reports.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadAnalytics();
    }
  }, [token]);

  if (loadingUser) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <RefreshCw className="w-8 h-8 text-cyber-neonBlue animate-spin" />
      </div>
    );
  }

  // Admin role check gate
  if (!user || !user.is_admin) {
    return (
      <div className="max-w-md mx-auto py-16">
        <GlassCard glowColor="pink" className="text-center flex flex-col items-center p-8">
          <ShieldAlert className="w-12 h-12 text-cyber-neonPink mb-4 animate-pulse" />
          <h3 className="font-orbitron font-bold text-lg text-white mb-2">ACCESS DEBARRED</h3>
          <p className="text-gray-500 text-xs leading-relaxed">
            The operational dashboard contains secure diagnostic indicators and is reserved for administrator credentials.
          </p>
        </GlassCard>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Admin Dashboard | AI Anime Portrait Studio</title>
      </Head>

      <div className="flex flex-col gap-8 w-full">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 pb-4">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-cyber-neonPurple animate-bounce" />
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-widest text-white font-orbitron">
                ADMIN OPERATIONS PANEL
              </h1>
              <p className="text-xs text-gray-500 font-sans mt-1">
                Real-time usage parameters, style preferences, print counters, and neural latency tracking.
              </p>
            </div>
          </div>
          
          <button
            onClick={loadAnalytics}
            className="p-2.5 rounded-lg border border-white/5 hover:border-cyber-neonBlue bg-cyber-card text-gray-400 hover:text-cyber-neonBlue transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Analytics reports rendering */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <RefreshCw className="w-10 h-10 text-cyber-neonPurple animate-spin mb-3" />
            <p className="font-orbitron text-xs text-cyber-neonPurple tracking-widest animate-pulse">
              LOADING OPERATIONAL METRICS...
            </p>
          </div>
        ) : error ? (
          <GlassCard className="text-center p-8">
            <p className="text-cyber-neonPink font-orbitron text-sm">{error}</p>
          </GlassCard>
        ) : analytics ? (
          <AnalyticsPanel data={analytics} />
        ) : null}

      </div>
    </>
  );
}
