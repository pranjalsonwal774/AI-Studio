import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useApi } from '../hooks/useApi';
import { Camera, Image as ImageIcon, History, Shield, LogOut, LogIn } from 'lucide-react';

export const Navbar: React.FC = () => {
  const router = useRouter();
  const { user, logout } = useApi();

  const navItems = [
    { name: 'STUDIO', path: '/', icon: Camera },
    { name: 'GALLERY', path: '/gallery', icon: ImageIcon },
    ...(user ? [{ name: 'HISTORY', path: '/history', icon: History }] : []),
    ...(user?.is_admin ? [{ name: 'ADMIN', path: '/admin', icon: Shield }] : [])
  ];

  return (
    <nav className="glass-panel sticky top-0 z-50 px-6 py-4 border-b border-white/5 backdrop-blur-md">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        
        {/* Futuristic neon branding */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="relative p-2 rounded-lg bg-cyber-purple/10 border border-cyber-purple/20 group-hover:border-cyber-blue/40 transition-colors">
            <Camera className="w-6 h-6 text-cyber-purple group-hover:text-cyber-blue transition-colors" />
            <div className="absolute inset-0 bg-cyber-purple/20 blur-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <span className="font-orbitron font-extrabold text-xl tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyber-purple via-pink-400 to-cyber-blue">
            ANIME<span className="text-white text-base font-normal font-sans ml-1">STUDIO</span>
          </span>
        </Link>

        {/* Navigation links */}
        <div className="hidden md:flex items-center gap-8">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = router.pathname === item.path;
            return (
              <Link 
                key={item.path} 
                href={item.path}
                className={`flex items-center gap-2 font-orbitron tracking-widest text-sm transition-all duration-300 ${
                  isActive 
                    ? 'text-cyber-neonBlue font-bold drop-shadow-[0_0_8px_#00f0ff]' 
                    : 'text-gray-400 hover:text-white hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.5)]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.name}
              </Link>
            );
          })}
        </div>

        {/* Authentication controls */}
        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-xs text-gray-500 font-orbitron">VISITOR</p>
                <p className="text-sm font-semibold text-gray-200">{user.username}</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-cyber-purple to-cyber-blue flex items-center justify-between p-[1px] shadow-neon-blue/30 shadow-sm">
                <div className="w-full h-full rounded-full bg-cyber-darker flex items-center justify-center font-orbitron text-xs font-bold text-cyber-neonBlue">
                  {user.username.substring(0, 2).toUpperCase()}
                </div>
              </div>
              <button 
                onClick={() => { logout(); router.push('/'); }}
                className="p-2 rounded-lg text-gray-400 hover:text-cyber-neonPink hover:bg-cyber-neonPink/10 transition-colors"
                title="Sign Out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <Link 
              href="/login" 
              className="flex items-center gap-2 font-orbitron text-xs tracking-wider border border-cyber-purple/40 hover:border-cyber-neonBlue px-4 py-2 rounded-lg bg-cyber-purple/5 hover:bg-cyber-blue/10 text-gray-300 hover:text-cyber-neonBlue shadow-sm hover:shadow-neon-blue/20 transition-all duration-300"
            >
              <LogIn className="w-4 h-4" />
              SIGN IN
            </Link>
          )}
        </div>

      </div>
    </nav>
  );
};
export default Navbar;
