import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Em, PageHeader } from "@/components/ui";

export default function NotFound() {
  return (
    <PageHeader kicker="404 · Page not found" title={<>This page has <Em>moved on.</Em></>} image="/images/datacenter.webp">
      <p className="lede max-w-xl">The link may be out of date. Try the domain catalogue, or head back to the start.</p>
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Link href="/domains/" className="btn btn-red">
          Explore domains
          <Icon name="arrow" size={18} />
        </Link>
        <Link href="/" className="btn btn-glass">
          Home
        </Link>
      </div>
    </PageHeader>
  );
}
