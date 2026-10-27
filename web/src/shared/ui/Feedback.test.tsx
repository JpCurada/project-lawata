import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTACT_EMAIL } from "../contact";
import { FeedbackPanel, buildFeedbackMailto } from "./Feedback";

afterEach(cleanup);

function Harness({ onSend }: { onSend: (href: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open feedback
      </button>
      <FeedbackPanel open={open} onClose={() => setOpen(false)} onSend={onSend} />
    </>
  );
}

describe("buildFeedbackMailto", () => {
  it("puts the topic in the subject and the message, page and reply address in the body", () => {
    const href = buildFeedbackMailto({
      topic: "Data or a plume",
      message: "  Plume 30 looks like a cloud shadow.  ",
      replyTo: "me@example.org",
      pageUrl: "https://lawata.example/plumes/30",
    });
    const url = new URL(href);
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe(CONTACT_EMAIL);
    expect(url.searchParams.get("subject")).toBe("[Lawata] Data or a plume");
    expect(url.searchParams.get("body")).toBe(
      "Plume 30 looks like a cloud shadow.\n\nPage: https://lawata.example/plumes/30\nReply to: me@example.org",
    );
  });

  it("leaves out the reply line when no email is given", () => {
    const href = buildFeedbackMailto({ topic: "Bug", message: "Hi", replyTo: " ", pageUrl: "https://x/" });
    expect(new URL(href).searchParams.get("body")).toBe("Hi\n\nPage: https://x/");
  });
});

describe("FeedbackPanel", () => {
  it("opens, requires a message, sends a mailto and returns focus on Escape", () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const opener = screen.getByRole("button", { name: "Open feedback" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Send feedback" });
    expect(document.activeElement).toBe(screen.getByLabelText("Topic"));
    expect(dialog.textContent).toContain("This opens your email app with the message ready to send.");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("alert").textContent).toBe("Write a message before sending.");
    expect(screen.getByLabelText("Message").getAttribute("aria-invalid")).toBe("true");
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "Bug" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "The map is blank." } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByLabelText("Your email (optional)"), { target: { value: "me@example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledOnce();
    const url = new URL(onSend.mock.calls[0][0] as string);
    expect(url.pathname).toBe(CONTACT_EMAIL);
    expect(url.searchParams.get("subject")).toBe("[Lawata] Bug");
    expect(url.searchParams.get("body")).toContain("The map is blank.");
    expect(url.searchParams.get("body")).toContain(`Page: ${window.location.href}`);
    expect(url.searchParams.get("body")).toContain("Reply to: me@example.org");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes with the close button", () => {
    render(<Harness onSend={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open feedback" }));
    fireEvent.click(screen.getByRole("button", { name: "Close feedback form" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
