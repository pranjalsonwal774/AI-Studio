import { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useApi } from '../hooks/useApi';
import { GlassCard } from '../components/GlassCard';
import { Key, Mail, User as UserIcon, LogIn, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

export default function LoginPage() {
  const router = useRouter();
  const { login, register } = useApi();

  const [isRegister, setIsRegister] = useState<boolean>(false);
  const [email, setEmail] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isRegister) {
        await register(email, username, password);
      } else {
        await login(username, password);
      }
      // Redirect back to studio home page
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>{isRegister ? 'Sign Up' : 'Sign In'} | AI Anime Portrait Studio</title>
      </Head>

      <div className="max-w-md mx-auto py-12">
        <GlassCard glowColor="purple" className="p-8">
          
          <div className="text-center mb-8">
            <h2 className="font-orbitron font-extrabold text-xl tracking-widest text-white">
              {isRegister ? 'INITIALIZE USER' : 'USER ACCESS'}
            </h2>
            <p className="text-xs text-gray-500 font-sans mt-1">
              {isRegister ? 'Create a local visitor profile to sync photo history' : 'Sign in to access histories, prints, and galleries'}
            </p>
            <div className="w-12 h-[2px] bg-cyber-purple/60 mx-auto mt-4" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {error && (
              <div className="p-3.5 rounded-lg bg-cyber-neonPink/10 border border-cyber-neonPink/20 text-xs text-cyber-neonPink text-center font-semibold">
                {error}
              </div>
            )}

            {isRegister && (
              <div className="flex flex-col gap-2">
                <label className="text-[10px] text-gray-400 font-orbitron tracking-wider">EMAIL ADDRESS</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@domain.com"
                    className="w-full bg-cyber-darker border border-white/5 focus:border-cyber-purple rounded-xl py-3 pl-10 pr-4 text-sm text-gray-200 outline-none transition-colors"
                  />
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="text-[10px] text-gray-400 font-orbitron tracking-wider">USERNAME</label>
              <div className="relative">
                <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="cyber_painter"
                  className="w-full bg-cyber-darker border border-white/5 focus:border-cyber-purple rounded-xl py-3 pl-10 pr-4 text-sm text-gray-200 outline-none transition-colors"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[10px] text-gray-400 font-orbitron tracking-wider">PASSWORD</label>
              <div className="relative">
                <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-cyber-darker border border-white/5 focus:border-cyber-purple rounded-xl py-3 pl-10 pr-4 text-sm text-gray-200 outline-none transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-3 font-orbitron font-bold text-xs tracking-widest border border-cyber-purple/60 hover:border-cyber-neonPurple py-3.5 rounded-xl bg-cyber-purple/10 hover:bg-cyber-purple/20 text-white flex items-center justify-center gap-2 transition-all shadow-neon-purple/20 shadow-sm"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  {isRegister ? 'CREATE PROFILE' : 'SIGN IN'}
                </>
              )}
            </button>
          </form>

          {/* Toggle register view link */}
          <div className="text-center mt-6 text-xs text-gray-500 font-sans">
            {isRegister ? 'Already registered?' : "Don't have a profile?"}{' '}
            <span
              onClick={() => { setIsRegister(!isRegister); setError(null); }}
              className="text-cyber-neonPurple underline cursor-pointer hover:text-white transition-colors"
            >
              {isRegister ? 'Sign In' : 'Register visitor account'}
            </span>
          </div>

        </GlassCard>
      </div>
    </>
  );
}
