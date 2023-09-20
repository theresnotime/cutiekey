/*
 * SPDX-FileCopyrightText: syuilo and other misskey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { ClipsRepository, MiNote, MiClip, ClipNotesRepository, NotesRepository } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { RoleService } from '@/core/RoleService.js';
import { IdService } from '@/core/IdService.js';
import type { MiLocalUser } from '@/models/entities/User.js';

@Injectable()
export class ClipService {
	public static NoSuchClipError = class extends Error {};
	public static AlreadyAddedError = class extends Error {};
	public static TooManyClipNotesError = class extends Error {};
	public static TooManyClipsError = class extends Error {};

	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.redisForSub)
		private redisForSub: Redis.Redis,

		@Inject(DI.clipsRepository)
		private clipsRepository: ClipsRepository,

		@Inject(DI.clipNotesRepository)
		private clipNotesRepository: ClipNotesRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private roleService: RoleService,
		private idService: IdService,
	) {
	}

	@bindThis
	public async create(me: MiLocalUser, name: string, isPublic: boolean, description: string | null): Promise<MiClip> {
		const currentCount = await this.clipsRepository.countBy({
			userId: me.id,
		});
		if (currentCount > (await this.roleService.getUserPolicies(me.id)).clipLimit) {
			throw new ClipService.TooManyClipsError();
		}

		const clip = await this.clipsRepository.insert({
			id: this.idService.genId(),
			createdAt: new Date(),
			userId: me.id,
			name: name,
			isPublic: isPublic,
			description: description,
		}).then(x => this.clipsRepository.findOneByOrFail(x.identifiers[0]));

		return clip;
	}

	@bindThis
	public async update(me: MiLocalUser, clipId: MiClip['id'], name: string | undefined, isPublic: boolean | undefined, description: string | null | undefined): Promise<void> {
		const clip = await this.clipsRepository.findOneBy({
			id: clipId,
			userId: me.id,
		});

		if (clip == null) {
			throw new ClipService.NoSuchClipError();
		}

		await this.clipsRepository.update(clip.id, {
			name: name,
			description: description,
			isPublic: isPublic,
		});
	}

	@bindThis
	public async delete(me: MiLocalUser, clipId: MiClip['id']): Promise<void> {
		const clip = await this.clipsRepository.findOneBy({
			id: clipId,
			userId: me.id,
		});

		if (clip == null) {
			throw new ClipService.NoSuchClipError();
		}

		await this.clipsRepository.delete(clip.id);
	}

	@bindThis
	public async addNote(me: MiLocalUser, clipId: MiClip['id'], noteId: MiNote['id']): Promise<void> {
		const clip = await this.clipsRepository.findOneBy({
			id: clipId,
			userId: me.id,
		});

		if (clip == null) {
			throw new ClipService.NoSuchClipError();
		}

		const currentCount = await this.clipNotesRepository.countBy({
			clipId: clip.id,
		});
		if (currentCount > (await this.roleService.getUserPolicies(me.id)).noteEachClipsLimit) {
			throw new ClipService.TooManyClipNotesError();
		}

		try {
			await this.clipNotesRepository.insert({
				id: this.idService.genId(),
				noteId: noteId,
				clipId: clip.id,
			});
		} catch (e) {
			if (isDuplicateKeyValueError(e)) {
				throw new ClipService.AlreadyAddedError();
			}
		}

		this.clipsRepository.update(clip.id, {
			lastClippedAt: new Date(),
		});

		this.notesRepository.increment({ id: noteId }, 'clippedCount', 1);
	}

	@bindThis
	public async removeNote(me: MiLocalUser, clipId: MiClip['id'], noteId: MiNote['id']): Promise<void> {
		const clip = await this.clipsRepository.findOneBy({
			id: clipId,
			userId: me.id,
		});

		if (clip == null) {
			throw new ClipService.NoSuchClipError();
		}

		await this.clipNotesRepository.delete({
			noteId: noteId,
			clipId: clip.id,
		});

		this.notesRepository.decrement({ id: noteId }, 'clippedCount', 1);
	}
}