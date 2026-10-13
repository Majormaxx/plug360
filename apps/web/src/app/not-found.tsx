import { Compass } from '@phosphor-icons/react/dist/ssr';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

export default function NotFound() {
  return (
    <EmptyState icon={<Compass className="size-5" />} title="Nothing at this address" action={<ButtonLink href="/">Go home</ButtonLink>}>
      The link may be cut off. Deal and receipt links are long, so ask for the full link again.
    </EmptyState>
  );
}
