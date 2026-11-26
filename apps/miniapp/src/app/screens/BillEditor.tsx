import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  allocateCentsByWeight,
  allocateCentsEqual,
  BILL_CURRENCY_OPTIONS,
  normalizeCurrencyCode,
  sanitizeOptionalUserText,
  sanitizeUserText,
  TEXT_LIMITS,
} from "@splitbot/shared";
import useEmblaCarousel from "embla-carousel-react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";

import { format, isValid, parse } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import AutoAnimateContainer from "@/components/AutoAnimateContainer";
import { FormErrorAlert } from "@/components/FormErrorAlert";
import { ReceiptScanPreview } from "@/components/ReceiptScanPreview";
import { ReceiptScanTransition } from "@/components/ReceiptScanTransition";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toUserFriendlyErrorMessage } from "@/lib/userFriendlyError";

import { type Item } from "../billTypes";
import {
  defaultNewBillMembers,
  parseStartParamHasCid,
  type TelegramGroupMember,
  useTelegramGroupMembers,
} from "@/lib/telegramGroupMembers";
import {
  isGroupLikeLaunch,
  useTelegramLaunchContext,
} from "@/lib/telegramLaunchContext";
import { isDevMockDataEnabled } from "@/lib/devFlags";
import {
  createBillSession,
  getSplitbotApiBase,
  resolveBillContextForApi,
  runReceiptOcr,
  updateBillDetails,
  updateMyPaymentDetails,
  uploadReceipt,
} from "@/lib/splitbotApi";
import { getItemDisplayEmoji } from "@/lib/itemEmoji";
import { Icon } from "@/components/ui/icon";
import { MemberAvatar } from "@/components/MemberAvatar";

function parseBillDate(value: string): Date | undefined {
  if (!value.trim()) return undefined;
  const parsed = parse(value, "yyyy-MM-dd", new Date());
  return isValid(parsed) ? parsed : undefined;
}

function formatBillDateValue(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function isNameInGroup(name: string, groupMembers: string[]): boolean {
  const n = name.trim().toLowerCase();
  return groupMembers.some((g) => g.toLowerCase() === n);
}

/** Prefer the group's spelling when the typed name matches case-insensitively. */
function canonicalMemberName(raw: string, groupMembers: string[]): string {
  const t = sanitizeUserText(raw, TEXT_LIMITS.memberName);
  if (!t) return "";
  const lower = t.toLowerCase();
  const match = groupMembers.find((g) => g.toLowerCase() === lower);
  return match ?? t;
}

function MembersCarousel({
  members,
  assignees,
  onToggleMember,
  getAvatarBgColors,
  getPhotoUrl,
}: {
  members: string[];
  assignees: string[];
  onToggleMember: (member: string, nextPressed: boolean) => void;
  getAvatarBgColors?: (name: string) => number[] | undefined;
  getPhotoUrl?: (name: string) => string | undefined;
}) {
  const [emblaRef] = useEmblaCarousel({
    loop: false,
    align: "start",
    dragFree: true,
  });

  return (
    <div
      ref={emblaRef}
      className="overflow-hidden cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-center gap-2">
        {members.map((member) => {
          const checked = assignees.includes(member);
          const avatarBgColors = getAvatarBgColors?.(member);
          const photoUrl = getPhotoUrl?.(member);

          return (
            <div key={member} className="flex-[0_0_auto]">
              <Toggle
                pressed={checked}
                onPressedChange={(nextPressed) =>
                  onToggleMember(member, nextPressed)
                }
                className="rounded-full text-sm p-1 pr-2.5 gap-1.5"
              >
                <MemberAvatar
                  name={member}
                  avatarBgColors={avatarBgColors}
                  photoUrl={photoUrl}
                />
                <span>{member}</span>
              </Toggle>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SortableChargeRow({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-80" : undefined}
    >
      <div className="flex items-start gap-3 py-3">
        <button
          type="button"
          aria-label="Drag to reorder"
          className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground"
          {...attributes}
          {...listeners}
        >
          <Icon name="IconChevronGrabberVertical" size={24} />
        </button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export interface BillEditorInitialBill {
  title: string;
  billDate: string;
  place: string | null;
  currency: string;
  members?: string[];
  /** Who fronted the merchant (display name). */
  paidByName?: string | null;
  /** Payer payment copy-text, when known. */
  paymentDetails?: string | null;
  items: Item[];
  charges?: Array<{
    id?: string;
    chargeType: string;
    amountCents: number;
    label?: string | null;
    ratePct?: number | null;
  }>;
}

export type BillEditorMode =
  /** Starting from scratch or from a receipt scan. Creates a new bill on save. */
  | {
      kind: "create";
      /** When true, an image will be uploaded + OCR'd at mount. */
      isFromReceiptScan: boolean;
      /** The image to upload/scan when `isFromReceiptScan` is true. */
      receiptFile?: File;
    }
  /** Edit an existing bill. Save PATCHes the server. */
  | {
      kind: "edit";
      billId: string;
      initial: BillEditorInitialBill;
    };

export interface BillEditorProps {
  mode: BillEditorMode;
  /** Called when the user presses the back button. */
  onBack?: () => void;
  /** Text for the back button. Defaults to "Back to home" / "Back". */
  backLabel?: string;
  /** Create mode: called after the server creates a bill (navigate to it). */
  onOpenBill?: (billId: string) => void;
  /** Edit mode: called after save succeeds. */
  onSaveComplete?: () => void;
  /** Edit mode: optional cancel handler (e.g. to close edit mode). */
  onCancel?: () => void;
}

export function BillEditor(props: BillEditorProps) {
  const SERVICE_CHARGE_ROW_ID = "builtin-service-charge";
  const TAX_ROW_ID = "builtin-tax";

  type CustomAdjustment = {
    id: string;
    name: string;
    amountType: "fixed" | "percentage";
    value: number;
  };

  const isEditMode = props.mode.kind === "edit";
  const initialBill =
    props.mode.kind === "edit" ? props.mode.initial : undefined;
  const editingBillId =
    props.mode.kind === "edit" ? props.mode.billId : null;
  const isFromReceiptScan =
    props.mode.kind === "create" && props.mode.isFromReceiptScan;
  const receiptFile =
    props.mode.kind === "create" ? props.mode.receiptFile : undefined;

  const launchCtx = useTelegramLaunchContext();
  const {
    members: groupMembers,
    isLoading: groupMembersLoading,
    status: groupRosterStatus,
    statusMessage: groupRosterStatusMessage,
  } = useTelegramGroupMembers();

  const groupMemberNames = useMemo(
    () => groupMembers.map((m) => m.name),
    [groupMembers],
  );

  const currentUserDisplayName = useMemo(() => {
    const u = launchCtx.currentUser;
    if (!u) return null;
    const first = u.first_name?.trim() ?? "";
    const last = u.last_name?.trim() ?? "";
    const full = `${first} ${last}`.trim();
    if (full) return full;
    if (u.username?.trim()) return u.username.trim();
    return String(u.id);
  }, [launchCtx.currentUser]);

  const memberByName = useMemo(
    () => new Map(groupMembers.map((m) => [m.name, m] as const)),
    [groupMembers],
  );

  const miniappApiBase = useMemo(
    () => import.meta.env.VITE_BOT_MINIAPP_API?.replace(/\/$/, "") ?? "",
    [],
  );

  const splitbotApiBase = useMemo(() => getSplitbotApiBase(), []);

  const billApiContext = useMemo(
    () => resolveBillContextForApi(launchCtx),
    [
      launchCtx.chat?.id,
      launchCtx.chat?.title,
      launchCtx.startParam,
      launchCtx.chatType,
      launchCtx.currentUser?.id,
    ],
  );

  const resolveMemberPhotoUrl = useCallback(
    (mem: TelegramGroupMember | undefined) => {
      if (!mem) return undefined;
      if (mem.photoUrl) return mem.photoUrl;
      if (mem.avatarProxyPath && miniappApiBase) {
        return `${miniappApiBase}${mem.avatarProxyPath}`;
      }
      return undefined;
    },
    [miniappApiBase],
  );

  const allowAutofillFromGroupContext = useMemo(() => {
    if (isGroupLikeLaunch(launchCtx)) return true;
    if (parseStartParamHasCid(launchCtx.startParam)) return true;
    return false;
  }, [launchCtx]);

  const [billMembers, setBillMembers] = useState<string[]>(() => {
    if (initialBill) {
      const members = new Set<string>();
      for (const m of initialBill.members ?? []) {
        if (m.trim()) members.add(m.trim());
      }
      for (const it of initialBill.items) {
        for (const a of it.assignees) members.add(a);
      }
      return Array.from(members);
    }
    return [];
  });
  const [paidByName, setPaidByName] = useState<string | null>(() => {
    const initial = initialBill?.paidByName?.trim();
    if (initial) return initial;
    return null;
  });
  const [isPaidByDialogOpen, setIsPaidByDialogOpen] = useState(false);
  /** null = untouched, so we never overwrite saved details with an empty value. */
  const [paymentDetailsDraft, setPaymentDetailsDraft] = useState<string | null>(
    null,
  );
  const [membersDrawerOpen, setMembersDrawerOpen] = useState(false);
  const [currencyDrawerOpen, setCurrencyDrawerOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [manualMemberInput, setManualMemberInput] = useState("");
  const [manualMemberError, setManualMemberError] = useState<string | null>(
    null,
  );
  const didApplyAutofillRef = useRef(false);

  const [items, setItems] = useState<Item[]>(() =>
    initialBill ? initialBill.items.map((it) => ({ ...it })) : [],
  );
  const [ocrDiscountAdjustments, setOcrDiscountAdjustments] = useState<
    CustomAdjustment[]
  >([]);

  type OcrPhase =
    | "idle"
    | "loading"
    | "uploading"
    | "scanning"
    | "ok"
    | "error"
    | "skipped";
  const [ocrPhase, setOcrPhase] = useState<OcrPhase>(() => {
    if (isEditMode) return "skipped";
    if (isFromReceiptScan && receiptFile) return "uploading";
    return "idle";
  });
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [scanWaveDone, setScanWaveDone] = useState(false);
  const handleScanWaveComplete = useCallback(() => {
    setScanWaveDone(true);
  }, []);
  useEffect(() => {
    setScanWaveDone(false);
  }, [receiptFile]);
  const isOcrProcessing =
    ocrPhase === "loading" || ocrPhase === "uploading" || ocrPhase === "scanning";
  const showOnlyOcrStatus =
    isFromReceiptScan && (isOcrProcessing || ocrPhase === "error");
  /** Server bill session id when created via API (receipt scan or "Open bill"). */
  const [serverBillId, setServerBillId] = useState<string | null>(
    editingBillId,
  );
  const [isSavingBill, setIsSavingBill] = useState(false);
  const [saveBillError, setSaveBillError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditMode) {
      setOcrPhase("skipped");
      return;
    }
    if (!isFromReceiptScan || !receiptFile) {
      setOcrPhase("skipped");
      return;
    }
    const useMocks = isDevMockDataEnabled();
    if (!splitbotApiBase && !useMocks) {
      setOcrPhase("error");
      setOcrError(
        "Configure VITE_SPLITBOT_API (Splitrr API URL) to scan receipts from the web app.",
      );
      return;
    }
    if (!billApiContext) {
      setOcrPhase("error");
      setOcrError(
        "Open Splitrr from a Telegram group (via /split) so this bill can bind to that chat.",
      );
      return;
    }
    // Wait for Telegram.WebApp.initData — uploading without it yields missing/invalid_init_data.
    // Local mock mode skips Telegram auth entirely.
    if (!useMocks && !launchCtx.initData?.trim()) {
      setOcrPhase("uploading");
      setOcrError(null);
      const waitId = window.setTimeout(() => {
        setOcrPhase("error");
        setOcrError(
          "Telegram login data is missing. Close Splitrr and re-open it from /split, then try again.",
        );
      }, 3000);
      return () => window.clearTimeout(waitId);
    }

    let cancelled = false;
    setOcrPhase("uploading");
    setOcrError(null);

    const day = new Date().toISOString().slice(0, 10);
    const title = `Receipt ${day}`;
    const apiBase = splitbotApiBase || "http://localhost:3000";

    (async () => {
      try {
        const { billId } = await createBillSession(apiBase, {
          telegramChatId: billApiContext.telegramChatId,
          groupTitle: billApiContext.groupTitle,
          title,
          createdByUserId: launchCtx.currentUser?.id,
          billDate: day,
          place: null,
        });
        setServerBillId(billId);
        const { key: storageKey } = await uploadReceipt(
          apiBase,
          billId,
          receiptFile,
        );
        if (cancelled) return;
        setOcrPhase("scanning");
        const parsed = await runReceiptOcr(apiBase, billId, storageKey);
        if (cancelled) return;
        setCurrencyCode(normalizeCurrencyCode(parsed.currency));
        const merchant = sanitizeUserText(
          parsed.merchantName,
          TEXT_LIMITS.billTitle,
        );
        if (merchant) {
          setBillTitle(merchant);
        } else {
          setBillTitle(
            (prev) =>
              sanitizeUserText(prev, TEXT_LIMITS.billTitle) || title,
          );
        }
        setItems(
          parsed.items.map((it, i) => ({
            id: `ocr-${billId}-${i}`,
            name: sanitizeUserText(it.name, TEXT_LIMITS.itemName) || "Item",
            totalPriceCents: it.totalPriceCents,
            assignees: [],
          })),
        );
        const ocrAdjustments: CustomAdjustment[] = (
          parsed.discountAdjustments ?? []
        ).map((adjustment, i) => ({
          id: `ocr-discount-${billId}-${i}`,
          name:
            sanitizeUserText(adjustment.name, TEXT_LIMITS.chargeLabel) ||
            "Discount",
          amountType: "fixed" as const,
          value: adjustment.amountCents / 100,
        }));
        // Charges/tax only when present on the receipt — never invent fixed rates.
        const scCents = parsed.serviceChargeCents ?? 0;
        const taxCentsFromOcr = parsed.taxCents ?? 0;
        const scRate =
          typeof parsed.serviceChargeRatePct === "number" &&
          parsed.serviceChargeRatePct > 0
            ? parsed.serviceChargeRatePct
            : null;
        const taxRate =
          typeof parsed.taxRatePct === "number" && parsed.taxRatePct > 0
            ? parsed.taxRatePct
            : null;
        if (scCents > 0 && scRate != null) {
          setServiceChargeRatePct(scRate);
          setServiceChargeRateInput(String(scRate));
          setIsServiceChargeEnabled(true);
        } else {
          setIsServiceChargeEnabled(false);
          if (scCents > 0) {
            ocrAdjustments.push({
              id: `ocr-service-${billId}`,
              name: "Service Charge",
              amountType: "fixed",
              value: scCents / 100,
            });
          }
        }
        if (taxCentsFromOcr > 0 && taxRate != null) {
          setTaxRatePct(taxRate);
          setTaxRateInput(String(taxRate));
          setIsTaxEnabled(true);
        } else {
          setIsTaxEnabled(false);
          if (taxCentsFromOcr > 0) {
            ocrAdjustments.push({
              id: `ocr-tax-${billId}`,
              name: "Tax",
              amountType: "fixed",
              value: taxCentsFromOcr / 100,
            });
          }
        }
        setOcrDiscountAdjustments(ocrAdjustments);
        setOcrPhase("ok");
      } catch (e) {
        if (!cancelled) {
          setOcrPhase("error");
          setOcrError(toUserFriendlyErrorMessage(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isEditMode,
    isFromReceiptScan,
    receiptFile,
    splitbotApiBase,
    billApiContext,
    launchCtx.currentUser?.id,
    launchCtx.initData,
  ]);

  const [isAddingManualItem, setIsAddingManualItem] = useState(false);
  const [manualItemName, setManualItemName] = useState("");
  const [manualItemTotalPrice, setManualItemTotalPrice] = useState("");
  const [manualItemError, setManualItemError] = useState<string | null>(null);
  const DELETE_CONFIRM_SERVICE_CHARGE = "charge:service";
  const DELETE_CONFIRM_TAX = "charge:tax";
  const deleteConfirmKeyForItem = (id: string) => `item:${id}`;
  const deleteConfirmKeyForAdjustment = (id: string) => `adjustment:${id}`;

  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<"name" | "price" | null>(
    null,
  );
  const [draftItemName, setDraftItemName] = useState("");
  const [draftItemTotalPrice, setDraftItemTotalPrice] = useState("");

  const [currencyCode, setCurrencyCode] = useState(
    () => initialBill?.currency ?? "MVR",
  );
  const currencyLabel = currencyCode;
  const initialCharges = initialBill?.charges ?? [];
  const initialService = initialCharges.find(
    (c) => c.chargeType === "service",
  );
  const initialTax = initialCharges.find((c) => c.chargeType === "tax");
  const initialCustomCharges = initialCharges.filter(
    (c) =>
      c.chargeType !== "service" &&
      c.chargeType !== "tax",
  );

  const inferPct = (amountCents: number, baseCents: number): number | null => {
    if (amountCents <= 0 || baseCents <= 0) return null;
    return Math.round((amountCents / baseCents) * 10000) / 100;
  };
  const initialItemsSubtotal = (initialBill?.items ?? []).reduce(
    (s, it) => s + it.totalPriceCents,
    0,
  );
  const initialServicePct =
    initialService?.ratePct && initialService.ratePct > 0
      ? initialService.ratePct
      : initialService
        ? inferPct(initialService.amountCents, initialItemsSubtotal) ?? 10
        : 10;
  const initialServiceAmount = initialService?.amountCents ?? 0;
  const initialTaxPct =
    initialTax?.ratePct && initialTax.ratePct > 0
      ? initialTax.ratePct
      : initialTax
        ? inferPct(
            initialTax.amountCents,
            initialItemsSubtotal + initialServiceAmount,
          ) ?? 8
        : 8;

  // Latent rates for when the user manually adds a charge; OCR overwrites when present.
  const [serviceChargeRatePct, setServiceChargeRatePct] =
    useState(initialServicePct);
  const [taxRatePct, setTaxRatePct] = useState(initialTaxPct);
  const [serviceChargeRateInput, setServiceChargeRateInput] = useState(
    String(initialServicePct),
  );
  const [taxRateInput, setTaxRateInput] = useState(String(initialTaxPct));
  const [editingRateField, setEditingRateField] = useState<
    "serviceCharge" | "tax" | null
  >(null);
  // Do not auto-apply fixed SC/tax — enable from OCR, saved charges, or manual Add.
  const [isServiceChargeEnabled, setIsServiceChargeEnabled] = useState(
    () => !!initialService && initialService.amountCents !== 0,
  );
  const [isTaxEnabled, setIsTaxEnabled] = useState(
    () => !!initialTax && initialTax.amountCents !== 0,
  );
  const hydratedCustomAdjustments: CustomAdjustment[] =
    initialCustomCharges.map((c, index) => {
      const rate =
        typeof c.ratePct === "number" && c.ratePct > 0 ? c.ratePct : null;
      return {
        id: c.id?.trim() || `saved-adj-${index}-${c.chargeType}`,
        name:
          c.label?.trim() ||
          (c.chargeType === "discount"
            ? "Discount"
            : c.chargeType === "tip"
              ? "Tip"
              : "Adjustment"),
        amountType: rate != null ? ("percentage" as const) : ("fixed" as const),
        value: rate != null ? rate : Math.round(c.amountCents) / 100,
      };
    });
  const [customAdjustments, setCustomAdjustments] = useState<
    CustomAdjustment[]
  >(() => hydratedCustomAdjustments);
  const [chargeRowOrder, setChargeRowOrder] = useState<string[]>(() => [
    SERVICE_CHARGE_ROW_ID,
    TAX_ROW_ID,
    ...hydratedCustomAdjustments.map((a) => a.id),
  ]);
  const [isAddingAdjustment, setIsAddingAdjustment] = useState(false);
  const [adjustmentNameInput, setAdjustmentNameInput] = useState("");
  const [adjustmentAmountType, setAdjustmentAmountType] = useState<
    "fixed" | "percentage"
  >("fixed");
  const [adjustmentValueInput, setAdjustmentValueInput] = useState("");
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);

  // Extra editable fields (edit mode uses these; create mode keeps defaults).
  const [billTitle, setBillTitle] = useState(
    () => initialBill?.title ?? "",
  );
  const [billDate, setBillDate] = useState(
    () =>
      initialBill?.billDate ?? new Date().toISOString().slice(0, 10),
  );
  const [billPlace, setBillPlace] = useState(
    () => initialBill?.place ?? "",
  );

  useEffect(() => {
    // Only apply OCR discount lines when OCR actually produced them —
    // do not wipe charges hydrated from a saved bill on mount.
    if (ocrDiscountAdjustments.length === 0) return;
    setCustomAdjustments(ocrDiscountAdjustments);
  }, [ocrDiscountAdjustments]);

  const resetManualItemForm = () => {
    setManualItemName("");
    setManualItemTotalPrice("");
    setManualItemError(null);
  };

  const submitManualItem = () => {
    const name = manualItemName.trim();
    const parsed = Number(manualItemTotalPrice);

    if (!name) {
      setManualItemError("Item name is required.");
      return;
    }
    if (!Number.isFinite(parsed) || parsed < 0) {
      setManualItemError("Enter a valid total price (e.g. 12.50).");
      return;
    }

    const totalPriceCents = Math.round(parsed * 100);
    if (totalPriceCents <= 0) {
      setManualItemError("Total price must be greater than 0.");
      return;
    }

    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        totalPriceCents,
        assignees: [],
      },
    ]);

    setIsAddingManualItem(false);
    resetManualItemForm();
  };
  const resetAdjustmentForm = () => {
    setAdjustmentNameInput("");
    setAdjustmentAmountType("fixed");
    setAdjustmentValueInput("");
    setAdjustmentError(null);
  };

  const submitAdjustment = () => {
    const name = adjustmentNameInput.trim();
    const parsed = Number(adjustmentValueInput);

    if (!name) {
      setAdjustmentError("Name is required.");
      return;
    }
    if (!Number.isFinite(parsed) || parsed === 0) {
      setAdjustmentError("Value must be a valid number and cannot be 0.");
      return;
    }

    setCustomAdjustments((prev) => [
      ...prev,
      {
        id: `adjustment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        amountType: adjustmentAmountType,
        value: parsed,
      },
    ]);
    setIsAddingAdjustment(false);
    resetAdjustmentForm();
  };

  useEffect(() => {
    if (groupMembersLoading) return;
    if (didApplyAutofillRef.current) return;
    didApplyAutofillRef.current = true;
    if (isEditMode) return;
    if (!allowAutofillFromGroupContext) return;

    // New bills: only the creator (current viewer) is selected. Roster stays
    // listed unchecked so the user taps to add others.
    const selected = defaultNewBillMembers({
      groupMembers,
      currentUserId: launchCtx.currentUser?.id,
      currentUserDisplayName,
    });
    if (selected.length > 0) {
      setBillMembers(selected);
    }
  }, [
    groupMembers,
    groupMembersLoading,
    allowAutofillFromGroupContext,
    isEditMode,
    launchCtx.currentUser?.id,
    currentUserDisplayName,
  ]);

  useEffect(() => {
    const allow = new Set(billMembers);
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        assignees: item.assignees.filter((a) => allow.has(a)),
      })),
    );
  }, [billMembers]);

  const billMembersOrdered = useMemo(() => {
    const fromGroup = groupMemberNames.filter((m) => billMembers.includes(m));
    const fromManual = billMembers.filter(
      (m) => !isNameInGroup(m, groupMemberNames),
    );
    return [...fromGroup, ...fromManual];
  }, [groupMemberNames, billMembers]);

  useEffect(() => {
    if (billMembersOrdered.length === 0) {
      if (paidByName != null) setPaidByName(null);
      return;
    }
    const stillOnBill =
      paidByName != null &&
      billMembersOrdered.some(
        (m) => m.toLowerCase() === paidByName.toLowerCase(),
      );
    if (stillOnBill) return;
    const self =
      currentUserDisplayName &&
      billMembersOrdered.find(
        (m) => m.toLowerCase() === currentUserDisplayName.toLowerCase(),
      );
    setPaidByName(self ?? billMembersOrdered[0] ?? null);
  }, [billMembersOrdered, paidByName, currentUserDisplayName]);

  const isPaidBySelf =
    paidByName != null &&
    currentUserDisplayName != null &&
    paidByName.toLowerCase() === currentUserDisplayName.toLowerCase();
  const paidByMember = paidByName ? memberByName.get(paidByName) : undefined;
  const knownPaymentDetails =
    paidByName &&
    initialBill?.paidByName &&
    paidByName.toLowerCase() === initialBill.paidByName.toLowerCase()
      ? initialBill.paymentDetails?.trim() || ""
      : "";

  const manualOnlyBillMembers = useMemo(
    () => billMembers.filter((m) => !isNameInGroup(m, groupMemberNames)),
    [billMembers, groupMemberNames],
  );

  const filteredCurrencyOptions = useMemo(() => {
    const q = currencyFilter.trim().toLowerCase();
    if (!q) return BILL_CURRENCY_OPTIONS;
    return BILL_CURRENCY_OPTIONS.filter(
      (o) =>
        o.code.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
    );
  }, [currencyFilter]);

  const addManualMember = () => {
    const canonical = canonicalMemberName(manualMemberInput, groupMemberNames);
    if (!canonical) {
      setManualMemberError("Enter a name.");
      return;
    }
    const already = billMembers.some(
      (m) => m.toLowerCase() === canonical.toLowerCase(),
    );
    if (already) {
      setManualMemberError("That person is already in this bill.");
      return;
    }
    setManualMemberError(null);
    setBillMembers((prev) => [...prev, canonical]);
    setManualMemberInput("");
  };

  const openMembersDrawer = () => {
    setManualMemberInput("");
    setManualMemberError(null);
    setMembersDrawerOpen(true);
  };

  const commitPercentageInput = (
    draftValue: string,
    fallback: number,
    setDraftValue: React.Dispatch<React.SetStateAction<string>>,
    setRate: React.Dispatch<React.SetStateAction<number>>,
  ) => {
    const parsed = Number(draftValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraftValue(String(fallback));
      return;
    }
    const normalized = Math.round(parsed * 100) / 100;
    setRate(normalized);
    setDraftValue(String(normalized));
  };
  const beginRateEdit = (field: "serviceCharge" | "tax") => {
    if (field === "serviceCharge") {
      setServiceChargeRateInput(String(serviceChargeRatePct));
    } else {
      setTaxRateInput(String(taxRatePct));
    }
    setEditingRateField(field);
  };

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      const assignees = item.assignees.filter(Boolean);
      if (assignees.length === 0) continue;
      const parts = allocateCentsEqual(item.totalPriceCents, assignees);
      for (const [member, share] of parts) {
        map.set(member, (map.get(member) ?? 0) + share);
      }
    }

    return billMembersOrdered
      .filter((member) => map.has(member))
      .map((member) => [member, map.get(member)!] as [string, number]);
  }, [items, billMembersOrdered]);

  const formatCents = (cents: number) => (cents / 100).toFixed(2);

  const subtotalCents = useMemo(
    () => items.reduce((sum, item) => sum + item.totalPriceCents, 0),
    [items],
  );
  const { serviceChargeCents, serviceChargeBaseCents, taxCents, taxBaseCents } =
    useMemo(() => {
      let runningBaseCents = subtotalCents;
      let nextServiceChargeCents = 0;
      let nextTaxCents = 0;
      let nextServiceChargeBaseCents = subtotalCents;
      let nextTaxBaseCents = subtotalCents;

      const orderedBuiltinRows = chargeRowOrder.filter(
        (rowId) => rowId === SERVICE_CHARGE_ROW_ID || rowId === TAX_ROW_ID,
      );

      if (!orderedBuiltinRows.includes(SERVICE_CHARGE_ROW_ID)) {
        orderedBuiltinRows.push(SERVICE_CHARGE_ROW_ID);
      }
      if (!orderedBuiltinRows.includes(TAX_ROW_ID)) {
        orderedBuiltinRows.push(TAX_ROW_ID);
      }

      for (const rowId of orderedBuiltinRows) {
        if (rowId === SERVICE_CHARGE_ROW_ID && isServiceChargeEnabled) {
          nextServiceChargeBaseCents = runningBaseCents;
          nextServiceChargeCents = Math.round(
            (runningBaseCents * serviceChargeRatePct) / 100,
          );
          runningBaseCents += nextServiceChargeCents;
        }

        if (rowId === TAX_ROW_ID && isTaxEnabled) {
          nextTaxBaseCents = runningBaseCents;
          nextTaxCents = Math.round((runningBaseCents * taxRatePct) / 100);
          runningBaseCents += nextTaxCents;
        }
      }

      return {
        serviceChargeCents: nextServiceChargeCents,
        serviceChargeBaseCents: nextServiceChargeBaseCents,
        taxCents: nextTaxCents,
        taxBaseCents: nextTaxBaseCents,
      };
    }, [
      subtotalCents,
      chargeRowOrder,
      isServiceChargeEnabled,
      isTaxEnabled,
      serviceChargeRatePct,
      taxRatePct,
      SERVICE_CHARGE_ROW_ID,
      TAX_ROW_ID,
    ]);
  const customAdjustmentRows = useMemo(
    () =>
      customAdjustments.map((adjustment) => {
        const cents =
          adjustment.amountType === "fixed"
            ? Math.round(adjustment.value * 100)
            : Math.round((subtotalCents * adjustment.value) / 100);
        return { ...adjustment, cents };
      }),
    [customAdjustments, subtotalCents],
  );
  const customAdjustmentsTotalCents = useMemo(
    () => customAdjustmentRows.reduce((sum, row) => sum + row.cents, 0),
    [customAdjustmentRows],
  );
  const grandTotalCents =
    subtotalCents + serviceChargeCents + taxCents + customAdjustmentsTotalCents;
  const customAdjustmentMap = useMemo(
    () =>
      new Map(
        customAdjustmentRows.map((adjustment) => [adjustment.id, adjustment]),
      ),
    [customAdjustmentRows],
  );
  const dndSensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 8 },
    }),
  );
  const splitTotals = useMemo(() => {
    const baseTotals = totals;
    if (!baseTotals.length) return baseTotals;

    const assignedSubtotalCents = items.reduce(
      (sum, item) =>
        item.assignees.length > 0 ? sum + item.totalPriceCents : sum,
      0,
    );
    const splitTargetCents =
      subtotalCents > 0
        ? Math.round((grandTotalCents * assignedSubtotalCents) / subtotalCents)
        : 0;
    const baseSplitTotalCents = baseTotals.reduce(
      (sum, [, cents]) => sum + cents,
      0,
    );
    const differenceCents = splitTargetCents - baseSplitTotalCents;
    if (differenceCents === 0) return baseTotals;

    const hasPositiveBase = baseSplitTotalCents > 0;
    const allocation = allocateCentsByWeight(
      differenceCents,
      baseTotals.map(([member, cents]) => ({
        id: member,
        weight: hasPositiveBase ? cents : 1,
      })),
    );

    return baseTotals.map(
      ([member, cents]) =>
        [member, cents + (allocation.get(member) ?? 0)] as [string, number],
    );
  }, [totals, items, subtotalCents, grandTotalCents]);
  const splitTotalCents = useMemo(
    () => splitTotals.reduce((sum, [, cents]) => sum + cents, 0),
    [splitTotals],
  );

  useEffect(() => {
    if (!deleteConfirmKey?.startsWith("item:")) return;
    const id = deleteConfirmKey.slice("item:".length);
    const stillExists = items.some((i) => i.id === id);
    if (!stillExists) setDeleteConfirmKey(null);
  }, [deleteConfirmKey, items]);

  useEffect(() => {
    if (!deleteConfirmKey?.startsWith("adjustment:")) return;
    const id = deleteConfirmKey.slice("adjustment:".length);
    const stillExists = customAdjustments.some((a) => a.id === id);
    if (!stillExists) setDeleteConfirmKey(null);
  }, [deleteConfirmKey, customAdjustments]);

  useEffect(() => {
    if (!editingItemId) return;
    if (!items.some((i) => i.id === editingItemId)) {
      setEditingItemId(null);
      setEditingField(null);
    }
  }, [editingItemId, items]);

  useEffect(() => {
    if (!deleteConfirmKey) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const clickedInsideConfirmedDeleteButton = !!target?.closest(
        `[data-delete-confirm-key="${deleteConfirmKey}"]`,
      );

      if (!clickedInsideConfirmedDeleteButton) {
        setDeleteConfirmKey(null);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [deleteConfirmKey]);

  useEffect(() => {
    const availableIds = [
      SERVICE_CHARGE_ROW_ID,
      TAX_ROW_ID,
      ...customAdjustments.map((adjustment) => adjustment.id),
    ];
    setChargeRowOrder((prev) => {
      const kept = prev.filter((id) => availableIds.includes(id));
      const missing = availableIds.filter((id) => !kept.includes(id));
      return [...kept, ...missing];
    });
  }, [customAdjustments, SERVICE_CHARGE_ROW_ID, TAX_ROW_ID]);

  const handleChargeRowDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setChargeRowOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const canOpenBillOnServer = !!splitbotApiBase && !!billApiContext;

  const saveBill = useCallback(async () => {
    setSaveBillError(null);

    const chargesPayload: Array<{
      chargeType: string;
      amountCents: number;
      label?: string | null;
      ratePct?: number | null;
    }> = [];
    if (isServiceChargeEnabled && serviceChargeCents !== 0) {
      chargesPayload.push({
        chargeType: "service",
        amountCents: serviceChargeCents,
        label: "Service Charge",
        ratePct: serviceChargeRatePct,
      });
    }
    if (isTaxEnabled && taxCents !== 0) {
      chargesPayload.push({
        chargeType: "tax",
        amountCents: taxCents,
        label: "Tax",
        ratePct: taxRatePct,
      });
    }
    for (const row of customAdjustmentRows) {
      if (row.cents === 0) continue;
      chargesPayload.push({
        chargeType: "custom",
        amountCents: row.cents,
        label:
          sanitizeUserText(row.name, TEXT_LIMITS.chargeLabel) || "Adjustment",
        ratePct: row.amountType === "percentage" ? row.value : null,
      });
    }

    const safePlace = sanitizeOptionalUserText(billPlace, TEXT_LIMITS.place);
    const persistPayload = {
      billDate,
      place: safePlace,
      members: billMembersOrdered.map((m) =>
        sanitizeUserText(m, TEXT_LIMITS.memberName),
      ).filter(Boolean),
      paidByName: paidByName
        ? sanitizeUserText(paidByName, TEXT_LIMITS.memberName) || null
        : null,
      items: items
        .map((it) => ({
          id: it.id,
          name: sanitizeUserText(it.name, TEXT_LIMITS.itemName),
          totalPriceCents: it.totalPriceCents,
          assignees: (it.assignees ?? [])
            .map((a) => sanitizeUserText(a, TEXT_LIMITS.memberName))
            .filter(Boolean),
        }))
        .filter((it) => it.name.length > 0),
      charges: chargesPayload,
    };

    const persistPaymentDetails = async () => {
      if (!splitbotApiBase || paymentDetailsDraft === null || !isPaidBySelf) {
        return;
      }
      const next =
        sanitizeUserText(paymentDetailsDraft, TEXT_LIMITS.paymentDetails) ||
        null;
      if (next === (initialBill?.paymentDetails?.trim() || null)) return;
      await updateMyPaymentDetails(splitbotApiBase, next);
    };

    // Edit mode: PATCH the existing bill.
    if (isEditMode && editingBillId && splitbotApiBase) {
      setIsSavingBill(true);
      try {
        const normalizedTitle =
          sanitizeUserText(billTitle, TEXT_LIMITS.billTitle) || "Untitled bill";
        await persistPaymentDetails();
        await updateBillDetails(splitbotApiBase, editingBillId, {
          title: normalizedTitle,
          ...persistPayload,
        });
        props.onSaveComplete?.();
      } catch (e) {
        setSaveBillError(toUserFriendlyErrorMessage(e));
      } finally {
        setIsSavingBill(false);
      }
      return;
    }

    // Create mode: persist items/members (OCR creates the session but not assignments).
    if (serverBillId && splitbotApiBase) {
      setIsSavingBill(true);
      try {
        const normalizedTitle =
          sanitizeUserText(billTitle, TEXT_LIMITS.billTitle) || "Untitled bill";
        await persistPaymentDetails();
        await updateBillDetails(splitbotApiBase, serverBillId, {
          title: normalizedTitle,
          ...persistPayload,
        });
        props.onOpenBill?.(serverBillId);
      } catch (e) {
        setSaveBillError(toUserFriendlyErrorMessage(e));
      } finally {
        setIsSavingBill(false);
      }
      return;
    }

    if (!splitbotApiBase || !billApiContext) return;
    setIsSavingBill(true);
    try {
      const day = new Date().toISOString().slice(0, 10);
      const title =
        sanitizeUserText(billTitle, TEXT_LIMITS.billTitle) || `Bill ${day}`;
      const { billId } = await createBillSession(splitbotApiBase, {
        telegramChatId: billApiContext.telegramChatId,
        groupTitle:
          sanitizeUserText(
            billApiContext.groupTitle,
            TEXT_LIMITS.groupTitle,
          ) || "Group",
        title,
        createdByUserId: launchCtx.currentUser?.id,
        billDate: billDate || day,
        place: safePlace,
        currency: normalizeCurrencyCode(currencyCode),
      });
      setServerBillId(billId);
      await persistPaymentDetails();
      await updateBillDetails(splitbotApiBase, billId, {
        title,
        ...persistPayload,
      });
      props.onOpenBill?.(billId);
    } catch (e) {
      setSaveBillError(toUserFriendlyErrorMessage(e));
    } finally {
      setIsSavingBill(false);
    }
  }, [
    isEditMode,
    editingBillId,
    splitbotApiBase,
    billApiContext,
    currencyCode,
    launchCtx.currentUser?.id,
    serverBillId,
    billTitle,
    billDate,
    billPlace,
    billMembersOrdered,
    paidByName,
    paymentDetailsDraft,
    isPaidBySelf,
    initialBill?.paymentDetails,
    items,
    isServiceChargeEnabled,
    isTaxEnabled,
    serviceChargeCents,
    taxCents,
    serviceChargeRatePct,
    taxRatePct,
    customAdjustmentRows,
    props,
  ]);

  const saveButtonLabel = isEditMode
    ? isSavingBill
      ? "Saving..."
      : "Save changes"
    : serverBillId
      ? "Open bill"
      : "Create & open bill";

  const saveButtonDisabled =
    isSavingBill ||
    (isEditMode
      ? !splitbotApiBase
      : !serverBillId &&
        (!canOpenBillOnServer || (isFromReceiptScan && isOcrProcessing)));

  const backLabel = props.backLabel ?? (isEditMode ? "Back" : "Back to home");

  const headerTitleNode = (
    <Input
      variant="title"
      value={billTitle}
      onChange={(e) => setBillTitle(e.target.value)}
      onBlur={() =>
        setBillTitle((prev) => sanitizeUserText(prev, TEXT_LIMITS.billTitle))
      }
      maxLength={TEXT_LIMITS.billTitle}
      placeholder={isEditMode ? "Bill title" : "Bill name"}
      aria-label="Bill name"
    />
  );

  const selectedBillDate = parseBillDate(billDate);

  const headerDescriptionNode = (
    <CardDescription className="flex flex-wrap items-center gap-2">
      <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-empty={!selectedBillDate}
              className="w-auto justify-start rounded-[12px] text-left font-normal data-[empty=true]:text-muted-foreground"
              aria-label="Bill date"
            />
          }
        >
          <Icon name="IconCalendar" size={16} />
          {selectedBillDate ? (
            format(selectedBillDate, "MMM d, yyyy")
          ) : (
            <span>Pick a date</span>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-auto overflow-hidden p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedBillDate}
            defaultMonth={selectedBillDate}
            onSelect={(date) => {
              if (!date) return;
              setBillDate(formatBillDateValue(date));
              setDatePickerOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <Input
        variant="compact"
        value={billPlace}
        onChange={(e) => setBillPlace(e.target.value)}
        onBlur={() =>
          setBillPlace(
            (prev) => sanitizeUserText(prev, TEXT_LIMITS.place) || "",
          )
        }
        maxLength={TEXT_LIMITS.place}
        placeholder="Place (optional)"
        className="min-w-0 flex-1"
      />
    </CardDescription>
  );

  const useScanWave =
    isFromReceiptScan &&
    Boolean(receiptFile) &&
    !scanWaveDone &&
    ocrPhase !== "error";

  const topBar = (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {props.onBack ? (
            <Button
              variant="outline"
              onClick={() => props.onBack?.()}
              className="w-max"
            >
              <Icon name="IconArrowLeft" size={20} />
              {backLabel}
            </Button>
          ) : null}
          {isEditMode && props.onCancel ? (
            <Button
              variant="outline"
              onClick={() => props.onCancel?.()}
              className="w-max"
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
  );

  const scanStatusSection = (
    <>
      {showOnlyOcrStatus ? (
        <div className="space-y-3">
          {isOcrProcessing && receiptFile ? (
            <ReceiptScanPreview
              file={receiptFile}
              active={isOcrProcessing}
              statusText={
                ocrPhase === "uploading"
                  ? "Uploading receipt…"
                  : "Scanning receipt…"
              }
            />
          ) : null}
          {isOcrProcessing && !receiptFile ? (
            <div className="rounded-[22px] border border-primary/25 bg-primary/10 p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-end gap-1" aria-hidden>
                  <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]"></span>
                  <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:120ms]"></span>
                  <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:240ms]"></span>
                </div>
                <p className="text-sm text-foreground">
                  {ocrPhase === "uploading"
                    ? "Uploading receipt…"
                    : "Scanning receipt…"}
                </p>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/20">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-primary/70"></div>
              </div>
            </div>
          ) : null}
          {ocrPhase === "error" ? (
            <div className="space-y-2 rounded-[22px] border border-primary/25 bg-primary/10 p-4">
              <p className="text-sm font-medium tracking-[-0.01em] text-foreground">
                Couldn&apos;t scan the receipt
              </p>
              <FormErrorAlert message={ocrError} />
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );

  const mainEditor = (
    <>
      <div className={cn("space-y-4", showOnlyOcrStatus && "hidden")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            {headerTitleNode}
            {headerDescriptionNode}
            {isFromReceiptScan ? (
              <div className="space-y-1 pt-1">
                {ocrPhase === "error" && ocrError ? (
                  <FormErrorAlert message={ocrError} />
                ) : null}
                {ocrPhase === "skipped" && !receiptFile ? (
                  <p className="text-sm text-muted-foreground">
                    Open{" "}
                    <span className="font-medium text-foreground">Scan</span> or{" "}
                    <span className="font-medium text-foreground">Upload</span>{" "}
                    from home and pick a receipt image to run OCR.
                  </p>
                ) : null}
                {ocrPhase === "idle" && !(isFromReceiptScan && receiptFile) ? (
                  <p className="text-sm text-muted-foreground">
                    Currency is taken from the receipt when it is scanned
                    (server OCR).
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="pt-2"></div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {billMembersOrdered.length === 0 ? (
              <Button
                type="button"
                className="flex-1 shrink-0 sm:w-auto"
                onClick={openMembersDrawer}
              >
                <Icon name="IconPeople" size={20} />
                Add members
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={openMembersDrawer}
              >
                <Icon name="IconPeople" size={20} />
                Members
                <Badge variant="secondary" className="ml-1">
                  {billMembersOrdered.length}
                </Badge>
              </Button>
            )}
            {!isFromReceiptScan ? (
              <Button
                type="button"
                id="bill-currency"
                variant="outline"
                className="h-9 w-full max-w-max justify-between gap-2 rounded-[12px] font-normal"
                aria-expanded={currencyDrawerOpen}
                aria-haspopup="dialog"
                onClick={() => {
                  setCurrencyFilter("");
                  setCurrencyDrawerOpen(true);
                }}
              >
                <span className="min-w-0 truncate text-left">
                  {currencyLabel}
                </span>
                <Icon
                  name="IconChevronDownMedium"
                  size={16}
                  className="text-muted-foreground"
                />
              </Button>
            ) : null}
          </div>
        </div>

        {billMembersOrdered.length > 0 ? (
          <div className="space-y-2">
            <div>
              <CardTitle className="text-xl">Payment details</CardTitle>
              <CardDescription>
                {paidByName
                  ? `How to pay ${paidByName}.`
                  : "How to pay the person who fronted the bill."}
              </CardDescription>
            </div>
            <Card className="space-y-3 rounded-[22px] border-0 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="shrink-0 text-sm text-muted-foreground">
                    Paid by
                  </span>
                  {paidByName ? (
                    <>
                      <MemberAvatar
                        name={paidByName}
                        avatarBgColors={paidByMember?.avatarBgColors}
                        photoUrl={resolveMemberPhotoUrl(paidByMember)}
                      />
                      <span className="truncate font-medium tracking-[-0.01em]">
                        {paidByName}
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Not set
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setIsPaidByDialogOpen(true)}
                >
                  Update
                </Button>
              </div>

              <div className="border-t border-white/[0.07]" />

              {isPaidBySelf ? (
                <div className="space-y-2">
                  <Input
                    value={
                      paymentDetailsDraft ??
                      initialBill?.paymentDetails?.trim() ??
                      ""
                    }
                    placeholder="e.g. Venmo @you"
                    maxLength={TEXT_LIMITS.paymentDetails}
                    onChange={(e) => setPaymentDetailsDraft(e.target.value)}
                    aria-label="Payment details"
                  />
                  <p className="text-sm text-muted-foreground">
                    How others should pay you (Venmo, PayNow, bank, etc.).
                  </p>
                </div>
              ) : knownPaymentDetails ? (
                <p className="break-words text-sm font-medium tracking-[-0.01em]">
                  {knownPaymentDetails}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {paidByName
                    ? `${paidByName} can add payment details on the bill.`
                    : "Pick who paid to see how to pay them."}
                </p>
              )}
            </Card>
          </div>
        ) : null}

        <div className="space-y-2">
          <AutoAnimateContainer className="space-y-2">
            {items.map((item) => (
              <Card
                key={item.id}
                className="rounded-[22px] border-0 p-3.5"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-lg leading-none select-none"
                      aria-hidden
                    >
                      {editingItemId === item.id && editingField === "name"
                        ? getItemDisplayEmoji({
                            name: draftItemName.trim() || item.name,
                            emoji: undefined,
                          })
                        : getItemDisplayEmoji(item)}
                    </span>
                    {editingItemId === item.id && editingField === "name" ? (
                      <Input
                        autoFocus
                        variant="compact"
                        value={draftItemName}
                        onChange={(e) => setDraftItemName(e.target.value)}
                        maxLength={TEXT_LIMITS.itemName}
                        onBlur={() => {
                          const nextName = sanitizeUserText(
                            draftItemName,
                            TEXT_LIMITS.itemName,
                          );
                          setEditingItemId(null);
                          setEditingField(null);

                          if (!nextName || nextName === item.name) return;
                          setItems((prev) =>
                            prev.map((existing) =>
                              existing.id === item.id
                                ? {
                                    ...existing,
                                    name: nextName,
                                    emoji: undefined,
                                  }
                                : existing,
                            ),
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                        className="h-7 w-44"
                      />
                    ) : (
                      <button
                        type="button"
                        className="border-0 bg-transparent p-0 text-left font-medium tracking-[-0.01em] hover:underline focus-visible:outline-none"
                        onClick={() => {
                          setEditingItemId(item.id);
                          setEditingField("name");
                          setDraftItemName(item.name);
                        }}
                      >
                        {item.name}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {editingItemId === item.id && editingField === "price" ? (
                      <Input
                        inputMode="decimal"
                        autoFocus
                        variant="compact"
                        value={draftItemTotalPrice}
                        onChange={(e) => setDraftItemTotalPrice(e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={() => {
                          const parsed = Number(draftItemTotalPrice);
                          const nextCents = Number.isFinite(parsed)
                            ? Math.round(parsed * 100)
                            : null;

                          setEditingItemId(null);
                          setEditingField(null);

                          if (nextCents === null) return;
                          if (nextCents <= 0) return;
                          if (nextCents === item.totalPriceCents) return;

                          setItems((prev) =>
                            prev.map((existing) =>
                              existing.id === item.id
                                ? { ...existing, totalPriceCents: nextCents }
                                : existing,
                            ),
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                        className="h-7 w-28 tabular-nums"
                      />
                    ) : (
                      <button
                        type="button"
                        className="cursor-text border-0 bg-transparent p-0 focus-visible:outline-none"
                        onClick={() => {
                          setEditingItemId(item.id);
                          setEditingField("price");
                          setDraftItemTotalPrice(
                            (item.totalPriceCents / 100).toFixed(2),
                          );
                        }}
                      >
                        <Badge className="tabular-nums">
                          {currencyLabel} {formatCents(item.totalPriceCents)}
                        </Badge>
                      </button>
                    )}

                    <Button
                      variant={
                        deleteConfirmKey === deleteConfirmKeyForItem(item.id)
                          ? "destructive"
                          : "outline"
                      }
                      size="xs"
                      data-delete-confirm-key={deleteConfirmKeyForItem(item.id)}
                      onClick={() => {
                        const key = deleteConfirmKeyForItem(item.id);
                        if (deleteConfirmKey === key) {
                          setItems((prev) =>
                            prev.filter((i) => i.id !== item.id),
                          );
                          setDeleteConfirmKey(null);
                          return;
                        }
                        setDeleteConfirmKey(key);
                      }}
                    >
                      {deleteConfirmKey === deleteConfirmKeyForItem(item.id) ? (
                        "Delete"
                      ) : (
                        <Icon name="IconTrashCanSimple" size={14} />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="w-full">
                  <MembersCarousel
                    members={billMembersOrdered}
                    assignees={item.assignees}
                    getAvatarBgColors={(name) =>
                      memberByName.get(name)?.avatarBgColors
                    }
                    getPhotoUrl={(name) =>
                      resolveMemberPhotoUrl(memberByName.get(name))
                    }
                    onToggleMember={(member, nextPressed) => {
                      setItems((prev) =>
                        prev.map((existing) => {
                          if (existing.id !== item.id) return existing;

                          const assignees = nextPressed
                            ? [...new Set([...existing.assignees, member])]
                            : existing.assignees.filter((a) => a !== member);

                          return {
                            ...existing,
                            assignees,
                          };
                        }),
                      );
                    }}
                  />
                </div>
              </Card>
            ))}
          </AutoAnimateContainer>

          <div className="pt-1">
            <Dialog
              open={isAddingManualItem}
              onOpenChange={(open) => {
                setIsAddingManualItem(open);
                if (!open) {
                  resetManualItemForm();
                }
              }}
            >
              <DialogTrigger
                render={<Button variant="outline" className="w-full" />}
              >
                Add item
              </DialogTrigger>
              <DialogContent>
                <DialogHeader className="text-left">
                  <DialogTitle>Add item</DialogTitle>
                  <DialogDescription>
                    Add a custom item and assign it after saving.
                  </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-2 text-left">
                  <label
                    className="text-left text-sm font-medium"
                    htmlFor="manual-item-name"
                  >
                    Item name
                  </label>
                  <Input
                    id="manual-item-name"
                    value={manualItemName}
                    onChange={(e) => {
                      setManualItemName(e.target.value);
                      setManualItemError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      submitManualItem();
                    }}
                    placeholder="e.g., Dessert"
                    className="text-left"
                  />

                  <label
                    className="text-left text-sm font-medium"
                    htmlFor="manual-item-total"
                  >
                    Total price
                  </label>
                  <Input
                    id="manual-item-total"
                    inputMode="decimal"
                    value={manualItemTotalPrice}
                    onChange={(e) => {
                      setManualItemTotalPrice(e.target.value);
                      setManualItemError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      submitManualItem();
                    }}
                    placeholder="e.g., 12.50"
                    className="text-left tabular-nums"
                  />

                  <FormErrorAlert message={manualItemError} />
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsAddingManualItem(false);
                      resetManualItemForm();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button onClick={submitManualItem}>Add item</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "space-y-2",
          (showOnlyOcrStatus || items.length === 0) && "hidden",
        )}
      >
        <div>
          <CardTitle className="text-xl">Charges & Tax</CardTitle>
          <CardDescription>Service fees, taxes, and discounts</CardDescription>
        </div>

        <Card className="overflow-hidden rounded-[22px] border-0 p-0">
          <CardContent className="divide-y divide-white/[0.07] px-4 py-2">
            <div className="flex items-center justify-between py-3">
              <span className="font-medium tracking-[-0.01em]">Subtotal</span>
              <span className="font-medium tabular-nums">
                {currencyLabel} {formatCents(subtotalCents)}
              </span>
            </div>

            <DndContext
              sensors={dndSensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleChargeRowDragEnd}
            >
              <SortableContext
                items={chargeRowOrder}
                strategy={verticalListSortingStrategy}
              >
                <AutoAnimateContainer className="divide-y divide-white/[0.07]">
                  {chargeRowOrder.map((rowId) => {
                    if (rowId === SERVICE_CHARGE_ROW_ID) {
                      // Only show when a service charge is active (OCR or added).
                      if (!isServiceChargeEnabled) {
                        return null;
                      }
                      return (
                        <SortableChargeRow key={rowId} id={rowId}>
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="font-medium">Service Charge</div>
                              <div className="text-xs text-muted-foreground">
                                Applied to {currencyLabel}{" "}
                                {formatCents(serviceChargeBaseCents)}
                              </div>
                            </div>

                            <div className="flex items-start gap-2">
                              <div className="text-right flex flex-col gap-1">
                                <Badge className="tabular-nums">
                                  {currencyLabel}{" "}
                                  {formatCents(serviceChargeCents)}
                                </Badge>
                                <div className="text-xs text-muted-foreground">
                                  {editingRateField === "serviceCharge" ? (
                                    <>
                                      <input
                                        autoFocus
                                        inputMode="decimal"
                                        aria-label="Service charge percentage"
                                        value={serviceChargeRateInput}
                                        onChange={(e) =>
                                          setServiceChargeRateInput(
                                            e.target.value,
                                          )
                                        }
                                        onBlur={() => {
                                          commitPercentageInput(
                                            serviceChargeRateInput,
                                            serviceChargeRatePct,
                                            setServiceChargeRateInput,
                                            setServiceChargeRatePct,
                                          );
                                          setEditingRateField(null);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter")
                                            e.currentTarget.blur();
                                          if (e.key === "Escape") {
                                            setServiceChargeRateInput(
                                              String(serviceChargeRatePct),
                                            );
                                            setEditingRateField(null);
                                          }
                                        }}
                                        className="h-6 w-16 rounded-[12px] border border-white/[0.08] bg-white/[0.055] px-2 text-right text-xs tabular-nums outline-none focus-visible:border-white/25 focus-visible:bg-white/[0.08] focus-visible:ring-[3px] focus-visible:ring-ring/40"
                                      />
                                      <span className="ml-1">%</span>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      className="hover:underline"
                                      onClick={() =>
                                        beginRateEdit("serviceCharge")
                                      }
                                    >
                                      {serviceChargeRatePct} %
                                    </button>
                                  )}
                                </div>
                              </div>
                              <Button
                                variant={
                                  deleteConfirmKey ===
                                  DELETE_CONFIRM_SERVICE_CHARGE
                                    ? "destructive"
                                    : "outline"
                                }
                                size="xs"
                                data-delete-confirm-key={
                                  DELETE_CONFIRM_SERVICE_CHARGE
                                }
                                onClick={() => {
                                  if (
                                    deleteConfirmKey ===
                                    DELETE_CONFIRM_SERVICE_CHARGE
                                  ) {
                                    setIsServiceChargeEnabled(false);
                                    setDeleteConfirmKey(null);
                                    return;
                                  }
                                  setDeleteConfirmKey(
                                    DELETE_CONFIRM_SERVICE_CHARGE,
                                  );
                                }}
                                aria-label="Remove service charge"
                              >
                                {deleteConfirmKey ===
                                DELETE_CONFIRM_SERVICE_CHARGE ? (
                                  "Delete"
                                ) : (
                                  <Icon name="IconTrashCanSimple" size={14} />
                                )}
                              </Button>
                            </div>
                          </div>
                        </SortableChargeRow>
                      );
                    }

                    if (rowId === TAX_ROW_ID) {
                      return (
                        <SortableChargeRow key={rowId} id={rowId}>
                          {isTaxEnabled ? (
                            <div className="flex items-start justify-between">
                              <div>
                                <div className="font-medium">Tax</div>
                                <div className="text-xs text-muted-foreground">
                                  Applied to {currencyLabel}{" "}
                                  {formatCents(taxBaseCents)}
                                </div>
                              </div>

                              <div className="flex items-start gap-3">
                                <div className="text-right flex flex-col gap-1">
                                  <Badge className="tabular-nums">
                                    {currencyLabel} {formatCents(taxCents)}
                                  </Badge>

                                  <div className="text-xs text-muted-foreground">
                                    {editingRateField === "tax" ? (
                                      <>
                                        <input
                                          autoFocus
                                          inputMode="decimal"
                                          aria-label="Tax percentage"
                                          value={taxRateInput}
                                          onChange={(e) =>
                                            setTaxRateInput(e.target.value)
                                          }
                                          onBlur={() => {
                                            commitPercentageInput(
                                              taxRateInput,
                                              taxRatePct,
                                              setTaxRateInput,
                                              setTaxRatePct,
                                            );
                                            setEditingRateField(null);
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter")
                                              e.currentTarget.blur();
                                            if (e.key === "Escape") {
                                              setTaxRateInput(
                                                String(taxRatePct),
                                              );
                                              setEditingRateField(null);
                                            }
                                          }}
                                          className="h-6 w-16 rounded-[12px] border border-white/[0.08] bg-white/[0.055] px-2 text-right text-xs tabular-nums outline-none focus-visible:border-white/25 focus-visible:bg-white/[0.08] focus-visible:ring-[3px] focus-visible:ring-ring/40"
                                        />
                                        <span className="ml-1">%</span>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        className="hover:underline"
                                        onClick={() => beginRateEdit("tax")}
                                      >
                                        {taxRatePct} %
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <Button
                                  variant={
                                    deleteConfirmKey === DELETE_CONFIRM_TAX
                                      ? "destructive"
                                      : "outline"
                                  }
                                  size="xs"
                                  data-delete-confirm-key={DELETE_CONFIRM_TAX}
                                  onClick={() => {
                                    if (
                                      deleteConfirmKey === DELETE_CONFIRM_TAX
                                    ) {
                                      setIsTaxEnabled(false);
                                      setDeleteConfirmKey(null);
                                      return;
                                    }
                                    setDeleteConfirmKey(DELETE_CONFIRM_TAX);
                                  }}
                                  aria-label="Remove tax"
                                >
                                  {deleteConfirmKey === DELETE_CONFIRM_TAX ? (
                                    "Delete"
                                  ) : (
                                    <Icon name="IconTrashCanSimple" size={14} />
                                  )}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between text-sm font-medium">
                              <button
                                type="button"
                                className="hover:underline"
                                onClick={() => setIsTaxEnabled(true)}
                              >
                                Add Tax
                              </button>
                              <div className="text-muted-foreground">
                                {editingRateField === "tax" ? (
                                  <>
                                    <input
                                      autoFocus
                                      inputMode="decimal"
                                      aria-label="Tax percentage"
                                      value={taxRateInput}
                                      onChange={(e) =>
                                        setTaxRateInput(e.target.value)
                                      }
                                      onBlur={() => {
                                        commitPercentageInput(
                                          taxRateInput,
                                          taxRatePct,
                                          setTaxRateInput,
                                          setTaxRatePct,
                                        );
                                        setEditingRateField(null);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                          e.currentTarget.blur();
                                        if (e.key === "Escape") {
                                          setTaxRateInput(String(taxRatePct));
                                          setEditingRateField(null);
                                        }
                                      }}
                                      className="h-6 w-16 rounded-[12px] border border-white/[0.08] bg-white/[0.055] px-2 text-right text-xs tabular-nums outline-none focus-visible:border-white/25 focus-visible:bg-white/[0.08] focus-visible:ring-[3px] focus-visible:ring-ring/40"
                                    />
                                    <span className="ml-1">%</span>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className="hover:underline"
                                    onClick={() => beginRateEdit("tax")}
                                  >
                                    {taxRatePct} %
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </SortableChargeRow>
                      );
                    }

                    const adjustment = customAdjustmentMap.get(rowId);
                    if (!adjustment) return null;
                    const amountDisplay =
                      adjustment.cents < 0
                        ? `- ${currencyLabel} ${formatCents(Math.abs(adjustment.cents))}`
                        : `${currencyLabel} ${formatCents(adjustment.cents)}`;
                    const metaLabel =
                      adjustment.amountType === "percentage"
                        ? `${adjustment.value}% of subtotal`
                        : "Fixed value";

                    return (
                      <SortableChargeRow key={adjustment.id} id={adjustment.id}>
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-medium">{adjustment.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {metaLabel}
                            </div>
                          </div>

                          <div className="flex items-start gap-2">
                            <div className="text-right flex flex-col gap-1">
                              <Badge className="tabular-nums">
                                {amountDisplay}
                              </Badge>
                            </div>
                            <Button
                              variant={
                                deleteConfirmKey ===
                                deleteConfirmKeyForAdjustment(adjustment.id)
                                  ? "destructive"
                                  : "outline"
                              }
                              size="xs"
                              data-delete-confirm-key={deleteConfirmKeyForAdjustment(
                                adjustment.id,
                              )}
                              onClick={() => {
                                const key = deleteConfirmKeyForAdjustment(
                                  adjustment.id,
                                );
                                if (deleteConfirmKey === key) {
                                  setCustomAdjustments((prev) =>
                                    prev.filter(
                                      (entry) => entry.id !== adjustment.id,
                                    ),
                                  );
                                  setDeleteConfirmKey(null);
                                  return;
                                }
                                setDeleteConfirmKey(key);
                              }}
                              aria-label={`Remove ${adjustment.name}`}
                            >
                              {deleteConfirmKey ===
                              deleteConfirmKeyForAdjustment(adjustment.id) ? (
                                "Delete"
                              ) : (
                                <Icon name="IconTrashCanSimple" size={14} />
                              )}
                            </Button>
                          </div>
                        </div>
                      </SortableChargeRow>
                    );
                  })}
                </AutoAnimateContainer>
              </SortableContext>
            </DndContext>

            <Dialog
              open={isAddingAdjustment}
              onOpenChange={(open) => {
                setIsAddingAdjustment(open);
                if (!open) resetAdjustmentForm();
              }}
            >
              <DialogTrigger
                render={<Button variant="outline" className="my-3 w-full" />}
              >
                Add charge or discount
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add charge or discount</DialogTitle>
                  <DialogDescription>
                    Choose fixed amount or percentage of subtotal.
                  </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="adjustment-name"
                  >
                    Name
                  </label>
                  <Input
                    id="adjustment-name"
                    value={adjustmentNameInput}
                    onChange={(e) => {
                      setAdjustmentNameInput(e.target.value);
                      setAdjustmentError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      submitAdjustment();
                    }}
                    placeholder="e.g., Service charge or Discount"
                  />

                  <label
                    className="text-sm font-medium"
                    htmlFor="adjustment-amount-type"
                  >
                    Amount type
                  </label>
                  <div
                    id="adjustment-amount-type"
                    className="flex items-center gap-1 rounded-full bg-white/[0.06] p-1"
                    role="radiogroup"
                    aria-label="Amount type"
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={adjustmentAmountType === "fixed"}
                      className={cn(
                        "flex-1 rounded-full px-3 py-2 text-sm font-medium transition-[background-color,color] duration-150",
                        adjustmentAmountType === "fixed"
                          ? "bg-white/[0.14] text-foreground"
                          : "text-[#b4b4b4] hover:text-foreground",
                      )}
                      onClick={() => {
                        setAdjustmentAmountType("fixed");
                        setAdjustmentError(null);
                      }}
                    >
                      Fixed ({currencyLabel})
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={adjustmentAmountType === "percentage"}
                      className={cn(
                        "flex-1 rounded-full px-3 py-2 text-sm font-medium transition-[background-color,color] duration-150",
                        adjustmentAmountType === "percentage"
                          ? "bg-white/[0.14] text-foreground"
                          : "text-[#b4b4b4] hover:text-foreground",
                      )}
                      onClick={() => {
                        setAdjustmentAmountType("percentage");
                        setAdjustmentError(null);
                      }}
                    >
                      Percentage (%)
                    </button>
                  </div>

                  <label
                    className="text-sm font-medium"
                    htmlFor="adjustment-value"
                  >
                    Value
                  </label>
                  <Input
                    id="adjustment-value"
                    inputMode="decimal"
                    value={adjustmentValueInput}
                    onChange={(e) => {
                      setAdjustmentValueInput(e.target.value);
                      setAdjustmentError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      submitAdjustment();
                    }}
                    placeholder={
                      adjustmentAmountType === "fixed"
                        ? "e.g., -10.00"
                        : "e.g., -5"
                    }
                    className="tabular-nums"
                  />

                  <FormErrorAlert message={adjustmentError} />
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsAddingAdjustment(false);
                      resetAdjustmentForm();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button onClick={submitAdjustment}>Add</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>

          <div className="flex items-center justify-between border-t border-white/[0.07] bg-surface-3 px-4 py-4 text-white">
            <span className="font-medium tracking-[-0.01em]">Grand Total</span>
            <span className="font-medium tabular-nums">
              {currencyLabel} {formatCents(grandTotalCents)}
            </span>
          </div>
        </Card>
      </div>

      <div
        className={cn(
          "space-y-2",
          (showOnlyOcrStatus || items.length === 0) && "hidden",
        )}
      >
        <div>
          <CardTitle className="text-xl">Split breakdown</CardTitle>
          <CardDescription>Amount each person owes.</CardDescription>
        </div>
        <Card className="gap-0 overflow-hidden rounded-[22px] border-0 p-0">
          <CardContent className="px-4 py-2">
            <AutoAnimateContainer className="divide-y divide-white/[0.07]">
              {splitTotals.map(([member, cents]) => (
                <div
                  key={member}
                  className="flex items-center justify-between py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <MemberAvatar
                      name={member}
                      avatarBgColors={memberByName.get(member)?.avatarBgColors}
                      photoUrl={resolveMemberPhotoUrl(memberByName.get(member))}
                    />
                    <span className="font-medium tracking-[-0.01em]">
                      {member}
                    </span>
                  </div>
                  <Badge variant="outline" className="tabular-nums">
                    {currencyLabel} {formatCents(cents)}
                  </Badge>
                </div>
              ))}
              <div className="flex items-center justify-between py-2.5 font-medium">
                <span className="tracking-[-0.01em]">Total</span>
                <span className="tabular-nums">
                  {currencyLabel} {formatCents(splitTotalCents)}
                </span>
              </div>
            </AutoAnimateContainer>
          </CardContent>
        </Card>
      </div>

      <div
        className={cn(
          "sticky bottom-0 z-10 -mx-4 border-t border-white/[0.07] bg-[#0a0a0a]/85 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md supports-backdrop-filter:bg-[#0a0a0a]/80",
          showOnlyOcrStatus && "hidden",
        )}
      >
        <div className="space-y-2">
          <FormErrorAlert
            title={isEditMode ? "Couldn't save the bill" : "Couldn't save the bill"}
            message={saveBillError}
          />
          <Button
            type="button"
            className="w-full"
            size="lg"
            disabled={saveButtonDisabled}
            aria-busy={isSavingBill}
            onClick={() => void saveBill()}
          >
            {saveButtonLabel}
          </Button>
          {!isEditMode && !canOpenBillOnServer ? (
            <p className="text-center text-xs text-muted-foreground">
              {!splitbotApiBase
                ? "Set VITE_SPLITBOT_API to your Splitrr API URL (build-time) to save bills on the server."
                : "Open Splitrr from a Telegram group (via /split) so this bill can bind to that chat."}
            </p>
          ) : null}
          {isEditMode && !splitbotApiBase ? (
            <p className="text-center text-xs text-muted-foreground">
              Set VITE_SPLITBOT_API to your Splitrr API URL (build-time) to save edits on the server.
            </p>
          ) : null}
        </div>
      </div>
    </>
  );

  const billDrawers = (
    <>
      <Dialog open={isPaidByDialogOpen} onOpenChange={setIsPaidByDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Who paid?</DialogTitle>
            <DialogDescription>
              Choose who fronted the bill. Others pay them back.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-[min(50vh,20rem)] space-y-1 overflow-y-auto">
            {billMembersOrdered.map((name) => {
              const selected =
                paidByName != null &&
                name.toLowerCase() === paidByName.toLowerCase();
              const mem = memberByName.get(name);
              return (
                <li key={`paid-by-option-${name}`}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]",
                      selected && "bg-white/[0.08]",
                    )}
                    onClick={() => {
                      setPaidByName(name);
                      setIsPaidByDialogOpen(false);
                    }}
                  >
                    <MemberAvatar
                      name={name}
                      avatarBgColors={mem?.avatarBgColors}
                      photoUrl={resolveMemberPhotoUrl(mem)}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium tracking-[-0.01em]">
                      {name}
                    </span>
                    {selected ? (
                      <Icon
                        name="IconCheck"
                        size={20}
                        className="shrink-0 text-foreground"
                        aria-label="Selected"
                      />
                    ) : (
                      <span className="size-5 shrink-0" aria-hidden />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>

      <Drawer open={membersDrawerOpen} onOpenChange={setMembersDrawerOpen}>
        <DrawerContent className="rounded-t-[28px] border-none bg-transparent p-0">
          <DrawerHeader>
            <DrawerTitle>Bill members</DrawerTitle>
            <DrawerDescription>
              Choose members who share this bill
            </DrawerDescription>
          </DrawerHeader>
          <div className="space-y-3 px-4 pb-2">
            <div className="flex gap-1">
              <label className="sr-only" htmlFor="manual-member-name">
                Add member by name or @username
              </label>
              <Input
                id="manual-member-name"
                value={manualMemberInput}
                onChange={(e) => {
                  setManualMemberInput(e.target.value);
                  setManualMemberError(null);
                }}
                maxLength={TEXT_LIMITS.memberName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addManualMember();
                  }
                }}
                placeholder="Add by name or @username…"
                className="min-w-0 flex-1 rounded-l-[12px] rounded-r-[6px]"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={addManualMember}
                className="rounded-l-[6px] rounded-r-[12px]"
              >
                Add
              </Button>
            </div>
            <FormErrorAlert message={manualMemberError} />
          </div>
          <div className="max-h-[80vh] space-y-4 overflow-y-auto px-4 pb-4 pt-2">
            {manualOnlyBillMembers.length > 0 ? (
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Waiting to join
                </div>
                {manualOnlyBillMembers.map((member) => {
                  const checked = billMembers.includes(member);
                  const id = `bill-members-manual-${member}`;
                  return (
                    <label
                      key={`manual:${member}`}
                      htmlFor={id}
                      className={`flex w-full cursor-pointer items-center gap-3 rounded-[16px] border p-2.5 pl-3 text-sm transition-colors hover:bg-white/[0.06] ${
                        checked
                          ? "border-white/[0.1] bg-white/[0.06]"
                          : "border-transparent"
                      }`}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <MemberAvatar
                          name={member}
                          avatarBgColors={
                            memberByName.get(member)?.avatarBgColors
                          }
                          photoUrl={resolveMemberPhotoUrl(
                            memberByName.get(member),
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="truncate">{member}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            Waiting on {member} to join
                          </span>
                        </span>
                      </span>
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={(next) => {
                          const nextPressed = next === true;
                          setBillMembers((prev) => {
                            if (nextPressed) {
                              if (prev.includes(member)) return prev;
                              return [...prev, member];
                            }
                            return prev.filter((m) => m !== member);
                          });
                        }}
                        aria-label={`Include ${member} in this bill`}
                        className="size-6 shrink-0 rounded-full"
                      />
                    </label>
                  );
                })}
              </div>
            ) : null}

            <div className="space-y-1">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                From this group
              </div>
              {groupMembersLoading ? (
                <p className="text-sm text-muted-foreground">Loading roster…</p>
              ) : groupMembers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {groupRosterStatusMessage ??
                    (groupRosterStatus === "auth_error"
                      ? "Could not authorize with Telegram. Close and re-open Splitrr from /split."
                      : groupRosterStatus === "no_context"
                        ? "Open Splitrr from /split in the group so the roster can load."
                        : "No members yet. Run /split in the group. You can still add people by name above.")}
                  {import.meta.env.DEV ? (
                    <>
                      {" "}
                      For local testing set{" "}
                      <code className="rounded bg-muted px-1 py-0.5 text-xs">
                        VITE_SPLITBOT_USE_MOCK_DATA=true
                      </code>
                      .
                    </>
                  ) : null}
                </p>
              ) : (
                groupMemberNames.map((member) => {
                  const checked = billMembers.includes(member);
                  const id = `bill-members-group-${member}`;
                  return (
                    <label
                      key={member}
                      htmlFor={id}
                      className={`flex w-full cursor-pointer items-center gap-3 rounded-[16px] border p-2.5 pl-3 text-sm transition-colors hover:bg-white/[0.06] ${
                        checked
                          ? "border-white/[0.1] bg-white/[0.06]"
                          : "border-transparent"
                      }`}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <MemberAvatar
                          name={member}
                          avatarBgColors={
                            memberByName.get(member)?.avatarBgColors
                          }
                          photoUrl={resolveMemberPhotoUrl(
                            memberByName.get(member),
                          )}
                        />
                        <span className="truncate">{member}</span>
                      </span>
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={(next) => {
                          const nextPressed = next === true;
                          setBillMembers((prev) => {
                            if (nextPressed) {
                              if (prev.includes(member)) return prev;
                              return [...prev, member];
                            }
                            return prev.filter((m) => m !== member);
                          });
                        }}
                        aria-label={`Include ${member} in this bill`}
                        className="size-6 shrink-0 rounded-full"
                      />
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <DrawerFooter>
            <Button
              type="button"
              className="w-full"
              onClick={() => setMembersDrawerOpen(false)}
            >
              Done
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Drawer
        open={currencyDrawerOpen}
        onOpenChange={(open) => {
          setCurrencyDrawerOpen(open);
          if (open) setCurrencyFilter("");
        }}
      >
        <DrawerContent className="rounded-t-[28px] border-none bg-transparent p-0">
          <DrawerHeader>
            <DrawerTitle>Currency</DrawerTitle>
            <DrawerDescription>
              Search by code or name, then choose the bill currency.
            </DrawerDescription>
          </DrawerHeader>
          <div className="space-y-3 px-4 pb-2">
            <label className="sr-only" htmlFor="currency-filter">
              Filter currencies
            </label>
            <Input
              id="currency-filter"
              variant="search"
              value={currencyFilter}
              onChange={(e) => setCurrencyFilter(e.target.value)}
              placeholder="Search by code or name…"
              autoComplete="off"
            />
          </div>
          <div className="max-h-[min(50vh,22rem)] space-y-1 overflow-y-auto px-4 pb-4">
            {filteredCurrencyOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No matching currencies.
              </p>
            ) : (
              filteredCurrencyOptions.map((o) => {
                const selected = o.code === currencyCode;
                return (
                  <button
                    key={o.code}
                    type="button"
                    onClick={() => {
                      setCurrencyCode(o.code);
                      setCurrencyDrawerOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left text-sm transition-colors hover:bg-white/[0.06]",
                      selected
                        ? "border-white/[0.1] bg-white/[0.06]"
                        : "border-transparent",
                    )}
                  >
                    <span className="min-w-0 flex-1">{o.label}</span>
                    {selected ? (
                      <Icon
                        name="IconCheckmark1"
                        size={20}
                        className="text-foreground"
                      />
                    ) : (
                      <span className="size-5 shrink-0" aria-hidden />
                    )}
                  </button>
                );
              })
            )}
          </div>
          <DrawerFooter>
            <Button
              type="button"
              className="w-full"
              onClick={() => setCurrencyDrawerOpen(false)}
            >
              Done
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );

  if (useScanWave) {
    return (
      <>
        <ReceiptScanTransition
          readyToReveal={ocrPhase === "ok"}
          onComplete={handleScanWaveComplete}
          scanContent={
            <div className="space-y-6">
              {topBar}
              {receiptFile ? (
                <ReceiptScanPreview
                  file={receiptFile}
                  active={isOcrProcessing}
                  statusText={
                    ocrPhase === "uploading"
                      ? "Uploading receipt…"
                      : "Scanning receipt…"
                  }
                />
              ) : null}
            </div>
          }
          revealedContent={
            <div className="space-y-6">
              {topBar}
              {mainEditor}
            </div>
          }
        />
        {billDrawers}
      </>
    );
  }

  return (
    <div className="space-y-6">
      {topBar}
      {scanStatusSection}
      {mainEditor}
      {billDrawers}
    </div>
  );
}
