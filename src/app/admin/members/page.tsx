"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  createMember,
  deleteMemberById,
  listMembers,
  updateMember,
  uploadMemberPhoto,
} from "./actions";

type ClubMember = {
  id: string;
  nickname: string;
  photo_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
};

type MemberForm = {
  id: string;
  nickname: string;
  photoUrl: string;
  isActive: boolean;
};

const emptyForm: MemberForm = {
  id: "",
  nickname: "",
  photoUrl: "",
  isActive: true,
};

const maxPhotoSize = 2 * 1024 * 1024;
const maxOriginalSize = 5 * 1024 * 1024;
const allowedPhotoTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

function publicMemberName(nickname: string) {
  const value = nickname.trim();

  if (!value) {
    return "ทนาย";
  }

  return value.startsWith("ทนาย") ? value : `ทนาย${value}`;
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Photo image could not be loaded."));
    };
    image.src = objectUrl;
  });
}

async function compressMemberPhoto(file: File) {
  const image = await loadImageFromFile(file);
  const size = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.max(0, Math.round((image.naturalWidth - size) / 2));
  const sourceY = Math.max(0, Math.round((image.naturalHeight - size) / 2));
  const outputSize = Math.min(900, size);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Photo image could not be processed.");
  }

  canvas.width = outputSize;
  canvas.height = outputSize;
  context.drawImage(image, sourceX, sourceY, size, size, 0, 0, outputSize, outputSize);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/webp", 0.85);
  });

  if (!blob) {
    throw new Error("Photo image could not be compressed.");
  }

  const outputName = file.name.replace(/\.[^.]+$/, "") || "member-photo";

  return new File([blob], `${outputName}.webp`, { type: "image/webp" });
}

export default function AdminMembersPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [form, setForm] = useState<MemberForm>(emptyForm);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview("");
      return;
    }

    const previewUrl = URL.createObjectURL(photoFile);
    setPhotoPreview(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [photoFile]);

  async function loadData() {
    setLoading(true);
    setError("");

    const result = await listMembers();

    if (!result.ok) {
      setMembers([]);
      setError(
        result.error
          ? `Could not load members: ${result.error}`
          : "Could not load members. Confirm the club_members table exists.",
      );
    } else {
      setMembers(result.members ?? []);
    }

    setLoading(false);
  }

  function resetForm() {
    setForm(emptyForm);
    setPhotoFile(null);
    setMessage("");
    setError("");
  }

  function scrollToEditForm() {
    window.setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      firstFieldRef.current?.focus({ preventScroll: true });
    }, 50);
  }

  function editMember(member: ClubMember) {
    setForm({
      id: member.id,
      nickname: member.nickname,
      photoUrl: member.photo_url ?? "",
      isActive: member.is_active,
    });
    setPhotoFile(null);
    setMessage("");
    setError("");
    scrollToEditForm();
  }

  async function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    try {
      let photoUrl = form.photoUrl.trim() || null;

      if (photoFile) {
        if (!allowedPhotoTypes.includes(photoFile.type)) {
          setError("Photo must be a png, jpg, jpeg, or webp image.");
          return;
        }

        if (photoFile.size > maxOriginalSize) {
          setError("Photo file must be 5MB or smaller before processing.");
          return;
        }

        let fileToUpload = photoFile;

        try {
          fileToUpload = await compressMemberPhoto(photoFile);
        } catch (compressionError) {
          console.error("admin member photo client compression failed", compressionError);
          setError("Photo could not be compressed. Please choose another image.");
          return;
        }

        if (fileToUpload.size > maxPhotoSize) {
          setError("Photo is still larger than 2MB after compression. Please choose a smaller image.");
          return;
        }

        const uploadData = new FormData();
        uploadData.append("file", fileToUpload);
        uploadData.append("nickname", form.nickname.trim());
        uploadData.append("memberId", form.id);

        const uploadResult = await uploadMemberPhoto(uploadData);

        if (!uploadResult.ok || !uploadResult.publicUrl) {
          console.error("admin member photo upload returned error", uploadResult);
          setError(uploadResult.error ?? "Photo upload failed.");
          return;
        }

        photoUrl = uploadResult.publicUrl;
      }

      const payload = {
        nickname: form.nickname.trim(),
        photo_url: photoUrl,
        is_active: form.isActive,
      };
      const result = form.id ? await updateMember(form.id, payload) : await createMember(payload);

      if (!result.ok) {
        console.error("admin member save returned error", result);
        setError(result.error ?? "Could not save member.");
        return;
      }

      setMessage(form.id ? "Member updated." : "Member added.");
      setForm(emptyForm);
      setPhotoFile(null);
      await loadData();
    } catch (saveError) {
      console.error("admin member save failed", saveError);
      setError("Could not save member. Please check the photo upload and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteMember(member: ClubMember) {
    const confirmed = window.confirm(`Delete ${member.nickname}?`);

    if (!confirmed) {
      return;
    }

    const result = await deleteMemberById(member.id);

    if (!result.ok) {
      setError(result.error ?? "Could not delete member.");
      return;
    }

    setMessage("Member deleted.");
    await loadData();
  }

  return (
    <main className="min-h-screen overflow-x-auto bg-[#f6f2ea] text-[#061426]">
      <section className="bg-[radial-gradient(circle_at_top_right,rgba(216,173,69,0.16),transparent_34%),linear-gradient(135deg,#061426,#091f39)] px-4 py-12 text-white sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
          <Link className="text-sm font-bold text-[#f4d58a] hover:text-white" href="/admin">
            Back to Admin
          </Link>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d8ad45]">
              KSW Admin
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight">Manage Members</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              Manage KSW club members shown on the public Team page.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:px-10">
        <form
          className="min-w-0 rounded-lg border border-[#d8ad45]/30 bg-white p-5 shadow-xl shadow-slate-900/10"
          onSubmit={saveMember}
          ref={formRef}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-2xl font-black">{form.id ? "Edit Member" : "Add Member"}</h2>
            </div>
            {form.id ? (
              <button className="text-sm font-black text-[#9b1c1f]" onClick={resetForm} type="button">
                Cancel
              </button>
            ) : null}
          </div>

          <div className="grid gap-4">
            <label className="grid gap-2 text-sm font-black">
              Nickname
              <span className="text-xs font-semibold text-slate-500">
                กรอกเฉพาะชื่อเล่น ไม่ต้องใส่คำว่า ทนาย
              </span>
              <input
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#d8ad45] focus:ring-2 focus:ring-[#d8ad45]/20"
                onChange={(event) => setForm((current) => ({ ...current, nickname: event.target.value }))}
                ref={firstFieldRef}
                required
                value={form.nickname}
              />
            </label>

            <div className="rounded-md border border-slate-200 bg-[#f8f3e7] px-3 py-2">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                Public Display
              </p>
              <p className="mt-1 text-base font-black text-[#061426]">
                {publicMemberName(form.nickname)}
              </p>
            </div>

            <label className="grid gap-2 text-sm font-black">
              Upload Photo
              <span className="text-xs font-semibold text-slate-500">
                รองรับ JPG, JPEG, PNG, WEBP และระบบจะย่อขนาดรูปอัตโนมัติก่อนอัปโหลด
              </span>
              <input
                accept="image/png,image/jpeg,image/jpg,image/webp"
                className="rounded-md border border-dashed border-[#d8ad45]/50 bg-[#f8f3e7] px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#061426] file:px-3 file:py-2 file:text-xs file:font-black file:text-[#f4d58a]"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;

                  if (!file) {
                    setPhotoFile(null);
                    return;
                  }

                  if (!allowedPhotoTypes.includes(file.type)) {
                    setError("Photo must be a png, jpg, jpeg, or webp image.");
                    setPhotoFile(null);
                    return;
                  }

                  if (file.size > maxOriginalSize) {
                    setError("Photo file must be 5MB or smaller before processing.");
                    setPhotoFile(null);
                    return;
                  }

                  setError("");
                  setPhotoFile(file);
                }}
                type="file"
              />
            </label>

            {photoPreview || form.photoUrl ? (
              <div className="rounded-md border border-slate-200 bg-[#f8f3e7] p-3">
                <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                  Photo Preview
                </p>
                <div className="flex size-28 items-center justify-center overflow-hidden rounded-full border-2 border-[#d8ad45] bg-white">
                  <img
                    alt="Member photo preview"
                    className="h-full w-full object-cover object-center"
                    src={photoPreview || form.photoUrl}
                  />
                </div>
              </div>
            ) : null}

            <label className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-sm font-black">
              <input
                checked={form.isActive}
                className="size-4 accent-[#d8ad45]"
                onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
                type="checkbox"
              />
              Active
            </label>

            {error ? (
              <p className="rounded-md border border-[#9b1c1f]/25 bg-[#9b1c1f]/10 px-3 py-2 text-sm font-bold text-[#9b1c1f]">
                {error}
              </p>
            ) : null}
            {message ? (
              <p className="rounded-md border border-emerald-700/20 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                {message}
              </p>
            ) : null}

            <button
              className="rounded-md bg-gradient-to-r from-[#d8ad45] to-[#f4d58a] px-5 py-3 text-sm font-black text-[#061426] shadow-lg shadow-[#d8ad45]/20 transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              {saving ? "Saving..." : form.id ? "Update Member" : "Add Member"}
            </button>
          </div>
        </form>

        <div className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="flex flex-col gap-2 border-b border-slate-200 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 h-0.5 w-12 rounded-full bg-[#d8ad45]" />
              <h2 className="text-2xl font-black">Member List</h2>
            </div>
            <p className="text-sm font-bold text-slate-500">{members.length} members</p>
          </div>

          {loading ? (
            <p className="p-5 text-sm font-bold text-slate-600">Loading members...</p>
          ) : members.length ? (
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[780px] border-collapse text-left text-sm">
                <thead className="bg-[#061426] text-xs uppercase tracking-[0.14em] text-[#f4d58a]">
                  <tr>
                    <th className="px-4 py-3">Photo</th>
                    <th className="px-4 py-3">Nickname</th>
                    <th className="px-4 py-3">Public Display</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr className="border-b border-slate-100 last:border-b-0" key={member.id}>
                      <td className="px-4 py-3">
                        <div className="flex size-14 items-center justify-center overflow-hidden rounded-full border border-[#d8ad45]/60 bg-[#f8f3e7]">
                          {member.photo_url ? (
                            <img
                              alt={publicMemberName(member.nickname)}
                              className="h-full w-full object-cover object-center"
                              src={member.photo_url}
                            />
                          ) : (
                            <span className="text-xs font-black text-[#061426]">KSW</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-black">{member.nickname}</td>
                      <td className="px-4 py-3 font-black text-[#061426]">
                        {publicMemberName(member.nickname)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-black ${
                            member.is_active
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {member.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{formatDate(member.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            className="rounded-md border border-[#d8ad45]/50 px-3 py-2 text-xs font-black text-[#061426] hover:bg-[#fff8e3]"
                            onClick={() => editMember(member)}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            className="rounded-md border border-[#9b1c1f]/35 px-3 py-2 text-xs font-black text-[#9b1c1f] hover:bg-[#9b1c1f]/10"
                            onClick={() => void deleteMember(member)}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-5 text-sm font-bold text-slate-600">
              No members found. Add the first club member after running the Supabase SQL.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
