import { platformLogoutAction } from '@/app/platform/login/actions';

export function PlatformLogoutButton() {
  return (
    <form action={platformLogoutAction}>
      <button type="submit" className="text-gray-400 hover:text-gray-100">
        Sair
      </button>
    </form>
  );
}
