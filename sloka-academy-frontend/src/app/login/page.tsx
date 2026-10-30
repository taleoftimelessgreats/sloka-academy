import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { SmartLink } from "@/components/SmartLink";
import { Em, PageHeader } from "@/components/ui";
import { lmsHref, lmsIsExternal } from "@/config/site";

export const metadata: Metadata = {
  title: "Login",
  description: "Sign in to the Sloka Academy learning platform (students) or the admin portal (staff).",
};

function SignInOption({
  icon,
  audience,
  title,
  children,
  action,
}: {
  icon: IconName;
  audience: string;
  title: string;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="glass edge relative flex flex-col p-8 sm:p-10">
      <Icon name={icon} size={26} className="text-red-hi" />
      <p className="kicker mt-8">{audience}</p>
      <h2 className="display mt-4 text-[2rem]">{title}</h2>
      <p className="mt-3 leading-relaxed text-muted">{children}</p>
      <div className="mt-9 flex flex-1 items-end">{action}</div>
    </div>
  );
}

/** One place for every sign-in: students go to the LMS, staff to the admin portal at /admin/. */
export default function LoginPage() {
  return (
    <>
      <PageHeader kicker="Login" title={<>Choose where to <Em>sign in.</Em></>} image="/images/code.webp">
        <p className="lede max-w-xl">Students continue to the learning platform. Staff sign in to the admin portal.</p>
      </PageHeader>
      <section className="section">
        <div className="wrap grid max-w-5xl gap-4 md:grid-cols-2">
          <SignInOption
            icon="book"
            audience="Students"
            title="Learning platform"
            action={
              <SmartLink href={lmsHref} external={lmsIsExternal} className="btn btn-red w-full sm:w-auto">
                Open the LMS
                <Icon name="arrow" size={18} />
              </SmartLink>
            }
          >
            Your classes, course material and assignments, hosted on Teachmint. Use the login details sent to you when you
            enrolled.
          </SignInOption>
          <SignInOption
            icon="shield"
            audience="Staff"
            title="Admin portal"
            action={
              // A plain link: /admin/ is the staff dashboard, a separate app rather than a page of this site.
              <a href="/admin/" className="btn btn-glass w-full sm:w-auto">
                Staff sign-in
                <Icon name="arrow" size={18} />
              </a>
            }
          >
            Enquiries, student profiles, sessions and certificates. For Sloka Academy staff only; accounts are created by an
            administrator.
          </SignInOption>
        </div>
      </section>
    </>
  );
}
