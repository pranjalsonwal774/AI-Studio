import type { AppProps } from 'next/app';
import '../styles/globals.css';
import { Navbar } from '../components/Navbar';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/router';

function MyApp({ Component, pageProps }: AppProps) {
  const router = useRouter();

  return (
    <div className="min-h-screen mesh-bg grid-overlay flex flex-col justify-between">
      <div>
        <Navbar />
        
        {/* Wrap in AnimatePresence for transitions */}
        <AnimatePresence mode="wait">
          <motion.main
            key={router.route}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="max-w-7xl mx-auto px-6 py-8 w-full"
          >
            <Component {...pageProps} />
          </motion.main>
        </AnimatePresence>
      </div>

      <footer className="w-full text-center py-6 text-[10px] text-gray-600 font-orbitron tracking-widest border-t border-white/5 mt-12 bg-cyber-darker/40">
        © {new Date().getFullYear()} AI ANIME PORTRAIT STUDIO BOOTH. ALL RIGHTS RESERVED.
      </footer>
    </div>
  );
}

export default MyApp;
