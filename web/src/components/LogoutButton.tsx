import { logoutAction } from '@/app/(tenant)/login/actions';

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button type="submit" className="text-ink-muted transition-colors hover:text-ink">
        Sair
      </button>
    </form>
  );
}
