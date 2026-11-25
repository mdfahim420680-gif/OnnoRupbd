import { CheckCircle2, Star } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { UserAvatar } from '../ui/UserAvatar';

interface ReviewFullModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  comment: string;
  customerName: string;
  avatarUrl?: string;
  avatarSources?: { google?: string; facebook?: string; uploaded?: string };
  isVerifiedPurchase: boolean;
  rating: number;
  createdAt?: string;
}

export function ReviewFullModal({
  open,
  onClose,
  title,
  comment,
  customerName,
  avatarUrl,
  avatarSources,
  isVerifiedPurchase,
  rating,
  createdAt,
}: ReviewFullModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title || 'Customer Review'} size="lg">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <UserAvatar user={{ name: customerName, avatarUrl, avatarSources }} size="md" />
            <div className="min-w-0">
              <p className="break-words font-bold text-[#0F1D3A]">{customerName}</p>
              {isVerifiedPurchase && (
                <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Verified Buyer
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 text-amber-400" aria-label={`${rating} out of 5 stars`}>
            {Array.from({ length: 5 }).map((_, index) => (
              <Star key={index} className={`h-4 w-4 ${index < rating ? 'fill-amber-400' : 'text-slate-300'}`} />
            ))}
          </div>
        </div>
        {title && <h3 className="text-base font-bold text-[#0B1730]">{title}</h3>}
        <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{comment}</p>
        {createdAt && (
          <p className="border-t border-slate-100 pt-3 text-xs text-slate-400">
            {new Date(createdAt).toLocaleString()}
          </p>
        )}
      </div>
    </Modal>
  );
}
