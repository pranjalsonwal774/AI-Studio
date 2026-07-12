import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useApi } from '../hooks/useApi';
import { PhotoGallery, PhotoRecord } from '../components/PhotoGallery';
import { GlassCard } from '../components/GlassCard';
import { ShieldAlert, RefreshCw, Key } from 'lucide-react';

export default function HistoryPage() {
  const router = useRouter();
  const { user, token, loadingUser, fetchHistory, triggerPrint, triggerUpscale } = useApi();

  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const loadHistory = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await fetchHistory();
      setPhotos(data);
    } catch (err) {
      console.error("Failed to load user history:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadHistory();
    }
  }, [token]);

  if (loadingUser) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <RefreshCw className="w-8 h-8 text-cyber-neonBlue animate-spin" />
      </div>
    );
  }

  // Auth gate
  if (!user) {
    return (
      <div className="max-w-md mx-auto py-16">
        <GlassCard glowColor="purple" className="text-center flex flex-col items-center p-8">
          <ShieldAlert className="w-12 h-12 text-cyber-purple mb-4 animate-pulse" />
          <h3 className="font-orbitron font-bold text-lg text-white mb-2">ACCESS RESTRICTED</h3>
          <p className="text-gray-500 text-xs leading-relaxed mb-6">
            Private generation histories are only available for registered session users. Register or sign in below.
          </p>
          <Link
            href="/login"
            className="font-orbitron tracking-widest text-xs font-bold border border-cyber-purple/60 hover:border-cyber-neonPurple px-6 py-3 rounded-lg bg-cyber-purple/10 hover:bg-cyber-purple/20 text-white flex items-center gap-2 transition-all shadow-neon-purple/20 shadow-md"
          >
            <Key className="w-4 h-4 text-cyber-neonPurple" />
            SIGN IN TO PROFILE
          </Link>
        </GlassCard>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>My History | AI Anime Portrait Studio</title>
      </Head>

      <div className="flex flex-col gap-8 w-full">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 pb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-widest text-white font-orbitron">
              MY CREATION HISTORY
            </h1>
            <p className="text-xs text-gray-500 font-sans mt-1">
              Private feed of anime paintings generated in your visitor session.
            </p>
          </div>
          
          <button
            onClick={loadHistory}
            className="p-2.5 rounded-lg border border-white/5 hover:border-cyber-neonBlue bg-cyber-card text-gray-400 hover:text-cyber-neonBlue transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Gallery */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <RefreshCw className="w-10 h-10 text-cyber-neonBlue animate-spin mb-3" />
            <p className="font-orbitron text-xs text-cyber-neonBlue tracking-widest animate-pulse">
              LOADING HISTORY LOGS...
            </p>
          </div>
        ) : (
          <PhotoGallery
            photos={photos}
            onPrint={triggerPrint}
            triggerUpscale={triggerUpscale}
          />
        )}

      </div>
    </>
  );
}
