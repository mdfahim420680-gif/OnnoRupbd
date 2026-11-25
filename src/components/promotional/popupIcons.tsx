import type { ReactNode } from 'react';
import {
  Activity,
  Award,
  BatteryCharging,
  BellRing,
  Bluetooth,
  CheckCircle2,
  Clock,
  Cpu,
  Droplets,
  Flame,
  Gift,
  Headphones,
  HeartPulse,
  Lock,
  Moon,
  Percent,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Truck,
  Watch,
  Wifi,
  Zap,
} from 'lucide-react';

export const POPUP_ICON_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'flame', label: 'Flame' },
  { key: 'sparkles', label: 'Sparkles' },
  { key: 'zap', label: 'Flash / Zap' },
  { key: 'heart-pulse', label: 'Heart Rate' },
  { key: 'activity', label: 'Sports / Activity' },
  { key: 'droplets', label: 'Waterproof' },
  { key: 'bell-ring', label: 'Notifications' },
  { key: 'battery-charging', label: 'Battery' },
  { key: 'moon', label: 'Sleep Tracking' },
  { key: 'watch', label: 'Smart Watch' },
  { key: 'bluetooth', label: 'Bluetooth' },
  { key: 'wifi', label: 'Wireless' },
  { key: 'cpu', label: 'Processor' },
  { key: 'smartphone', label: 'Mobile Sync' },
  { key: 'shield-check', label: 'Warranty / Shield' },
  { key: 'truck', label: 'Fast Delivery' },
  { key: 'rotate-ccw', label: 'Easy Return' },
  { key: 'headphones', label: '24/7 Support' },
  { key: 'award', label: 'Award / Certified' },
  { key: 'gift', label: 'Special Gift' },
  { key: 'percent', label: 'Discount' },
  { key: 'clock', label: 'Limited Time' },
  { key: 'lock', label: 'Secure Checkout' },
  { key: 'star', label: 'Top Rated' },
  { key: 'check-circle', label: 'Verified' },
];

export function renderPopupIcon(iconKey: string | undefined, className = 'h-4 w-4'): ReactNode {
  const key = (iconKey || '').trim().toLowerCase();
  switch (key) {
    case 'flame':
      return <Flame className={className} />;
    case 'zap':
      return <Zap className={className} />;
    case 'heart-pulse':
      return <HeartPulse className={className} />;
    case 'activity':
      return <Activity className={className} />;
    case 'droplets':
      return <Droplets className={className} />;
    case 'bell-ring':
      return <BellRing className={className} />;
    case 'battery-charging':
      return <BatteryCharging className={className} />;
    case 'moon':
      return <Moon className={className} />;
    case 'watch':
      return <Watch className={className} />;
    case 'bluetooth':
      return <Bluetooth className={className} />;
    case 'wifi':
      return <Wifi className={className} />;
    case 'cpu':
      return <Cpu className={className} />;
    case 'smartphone':
      return <Smartphone className={className} />;
    case 'shield-check':
      return <ShieldCheck className={className} />;
    case 'truck':
      return <Truck className={className} />;
    case 'rotate-ccw':
      return <RotateCcw className={className} />;
    case 'headphones':
      return <Headphones className={className} />;
    case 'award':
      return <Award className={className} />;
    case 'gift':
      return <Gift className={className} />;
    case 'percent':
      return <Percent className={className} />;
    case 'clock':
      return <Clock className={className} />;
    case 'lock':
      return <Lock className={className} />;
    case 'star':
      return <Star className={className} />;
    case 'check-circle':
      return <CheckCircle2 className={className} />;
    default:
      return <Sparkles className={className} />;
  }
}
