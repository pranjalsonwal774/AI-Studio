/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cyber: {
          darker: "#06060c",
          dark: "#0b0b16",
          card: "rgba(16, 16, 32, 0.4)",
          purple: "#d946ef",
          blue: "#06b6d4",
          neonPurple: "#bc34fa",
          neonBlue: "#00f0ff",
          neonPink: "#ff007f",
        }
      },
      boxShadow: {
        'neon-blue': '0 0 10px rgba(0, 240, 255, 0.5), 0 0 25px rgba(0, 240, 255, 0.2)',
        'neon-purple': '0 0 10px rgba(188, 52, 250, 0.5), 0 0 25px rgba(188, 52, 250, 0.2)',
        'neon-pink': '0 0 10px rgba(255, 0, 127, 0.5), 0 0 25px rgba(255, 0, 127, 0.2)',
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'scanline': 'scan 6s linear infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'border-flow': 'borderFlow 4s linear infinite',
        'spin-reverse': 'spin-reverse 1.5s linear infinite',
      },
      keyframes: {
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' }
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.6', boxShadow: '0 0 10px rgba(0, 240, 255, 0.3)' },
          '50%': { opacity: '1', boxShadow: '0 0 25px rgba(0, 240, 255, 0.8), 0 0 40px rgba(188, 52, 250, 0.5)' }
        },
        borderFlow: {
          '0%, 100%': { borderColor: 'rgba(0, 240, 255, 1)' },
          '33%': { borderColor: 'rgba(188, 52, 250, 1)' },
          '66%': { borderColor: 'rgba(255, 0, 127, 1)' }
        },
        'spin-reverse': {
          '0%': { transform: 'rotate(360deg)' },
          '100%': { transform: 'rotate(0deg)' }
        }
      }
    },
  },
  plugins: [],
}
