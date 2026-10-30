"use client";

import { useId, useRef, useState } from "react";
import { formsEnabled } from "@/config/site";
import { Icon } from "./Icon";
import { InquiryForm } from "./InquiryForm";

/** "2-Month Internship Program" -> "Sloka-Academy-2-Month-Internship-Program-Brochure.pdf" */
const downloadName = (title: string) => `Sloka-Academy-${title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}-Brochure.pdf`;

/** The plain download link for a brochure PDF. */
export function BrochureLink({ file, title, className = "btn btn-red" }: { file: string; title: string; className?: string }) {
  return (
    <a href={file} download={downloadName(title)} className={className}>
      <Icon name="download" size={18} />
      Download brochure
      <span className="sr-only">: {title} (PDF)</span>
    </a>
  );
}

/**
 * The short enquiry form, then the download button once the details are recorded. Without the
 * inquiry dashboard connected it is just the download button.
 */
export function BrochureRequest({ file, title, submitLabel = "Get the brochure" }: { file: string; title: string; submitLabel?: string }) {
  if (!formsEnabled) return <BrochureLink file={file} title={title} />;
  return (
    <InquiryForm
      source="brochure"
      brochure={file}
      submitLabel={submitLabel}
      sentMessage="Your brochure is ready. Admissions may call to answer any questions."
      sentAction={<BrochureLink file={file} title={title} className="btn btn-red w-full sm:w-auto" />}
    />
  );
}

/**
 * Brochure button for a list of brochures. With the inquiry dashboard connected it opens the short
 * form first (name, phone, email, stream) and shows the download button once the enquiry is recorded;
 * otherwise it is a plain download link.
 */
export function BrochureDownload({ file, title, className = "btn btn-glass w-full" }: { file: string; title: string; className?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [open, setOpen] = useState(false);

  if (!formsEnabled) return <BrochureLink file={file} title={title} className={className} />;

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          setOpen(true);
          dialogRef.current?.showModal();
        }}
      >
        <Icon name="download" size={18} />
        Download brochure
        <span className="sr-only">: {title}</span>
      </button>
      <dialog ref={dialogRef} aria-labelledby={headingId} className="dialog" onClose={() => setOpen(false)}>
        {open && (
          <div className="p-6 sm:p-9">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="kicker">Brochure</p>
                <h2 id={headingId} className="display mt-4 text-[1.8rem]">
                  {title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => dialogRef.current?.close()}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line-2 text-muted transition-colors hover:text-text"
              >
                <Icon name="close" size={18} />
                <span className="sr-only">Close</span>
              </button>
            </div>
            <p className="mb-7 mt-4 text-[0.95rem] leading-relaxed text-muted">
              Tell us where to reach you and the brochure is yours. Admissions may call to answer any questions.
            </p>
            <BrochureRequest file={file} title={title} submitLabel="Continue" />
          </div>
        )}
      </dialog>
    </>
  );
}
