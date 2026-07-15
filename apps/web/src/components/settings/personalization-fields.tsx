import type { PersonalizationFormState } from "./use-personalization-form";

const MEMORY_MAX = 8_000;

export function PersonalizationFields({
  form,
  update,
}: {
  form: PersonalizationFormState;
  update: (key: keyof PersonalizationFormState, value: string) => void;
}) {
  return (
    <>
      <PersonalizationNameField form={form} update={update} />
      <PersonalizationMemoryField form={form} update={update} />
    </>
  );
}

function PersonalizationNameField({
  form,
  update,
}: {
  form: PersonalizationFormState;
  update: (key: keyof PersonalizationFormState, value: string) => void;
}) {
  return (
    <section className="rounded-[24px] bg-secondary p-1 dark:bg-bg-lifted">
      <FieldLabel helper="Cheatcode will answer to this name." label="Your Cheatcode's Name" />
      <div className="group mt-2 cursor-text rounded-[22px] border-2 border-border bg-background">
        <div className="rounded-[20px] bg-background p-px">
          <div className="rounded-[19px] bg-gradient-to-b from-bg-secondary to-transparent px-4 py-3 transition-[box-shadow] duration-200 group-focus-within:shadow-[inset_0_0_40px_0_oklch(0.93_0.06_70_/_0.4)] dark:group-focus-within:shadow-[inset_0_0_40px_0_oklch(0.5_0.1_70_/_0.12)]">
            <input
              className="h-8 w-full bg-transparent font-medium text-[14px] text-foreground leading-5 outline-none placeholder:text-placeholder"
              maxLength={80}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Give your Cheatcode a name"
              value={form.name}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function PersonalizationMemoryField({
  form,
  update,
}: {
  form: PersonalizationFormState;
  update: (key: keyof PersonalizationFormState, value: string) => void;
}) {
  return (
    <section className="rounded-[24px] bg-secondary p-1 dark:bg-bg-lifted">
      <FieldLabel
        helper="Preferences and instructions for Cheatcode. No need to set the name here — that's handled above."
        label="Memory"
      />
      <div className="group mt-2 cursor-text rounded-[22px] border-2 border-border bg-background">
        <div className="rounded-[20px] bg-background p-px">
          <div className="rounded-[19px] bg-gradient-to-b from-bg-secondary to-transparent px-4 py-3 transition-[box-shadow] duration-200 group-focus-within:shadow-[inset_0_0_40px_0_oklch(0.93_0.06_70_/_0.4)] dark:group-focus-within:shadow-[inset_0_0_40px_0_oklch(0.5_0.1_70_/_0.12)]">
            <textarea
              className="min-h-[200px] w-full resize-none bg-transparent font-medium text-[14px] text-foreground leading-5 outline-none placeholder:text-placeholder"
              maxLength={MEMORY_MAX}
              onChange={(event) => update("memory", event.target.value)}
              placeholder={
                'Preferences and instructions — e.g. "I prefer short bullet points", "Always cite sources"...'
              }
              value={form.memory}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function FieldLabel({ helper, label }: { helper: string; label: string }) {
  return (
    <div className="space-y-2 px-4 pt-2 pb-2">
      <div className="font-medium text-[14px] text-fg-secondary leading-5">{label}</div>
      <p className="font-medium text-[14px] text-foreground leading-5">{helper}</p>
    </div>
  );
}
