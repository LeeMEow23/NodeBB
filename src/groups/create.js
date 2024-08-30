'use strict';

const meta = require('../meta');
const plugins = require('../plugins');
const slugify = require('../slugify');
const db = require('../database');

module.exports = function (Groups) {
	console.log('Alexis, now enter the refactored code');
	Groups.create = async function (data) {
		const isSystem = isSystemGroup(data);
		const timestamp = data.timestamp || Date.now();
		const disableJoinRequests = determineDisableJoinRequests(data);
		const disableLeave = parseInt(data.disableLeave, 10) === 1 ? 1 : 0;
		const isHidden = parseInt(data.hidden, 10) === 1;

		Groups.validateGroupName(data.name);

		await checkGroupExistence(data.name);

		const groupData = buildGroupData(data, timestamp, disableJoinRequests, disableLeave, isHidden, isSystem);

		await plugins.hooks.fire('filter:group.create', { group: groupData, data: data });

		await saveGroupData(groupData, timestamp, data.ownerUid);

		const finalGroupData = await Groups.getGroupData(groupData.name);
		plugins.hooks.fire('action:group.create', { group: finalGroupData });
		return finalGroupData;
	};

	function isSystemGroup(data) {
		return data.system === true || parseInt(data.system, 10) === 1 ||
			Groups.systemGroups.includes(data.name) ||
			Groups.isPrivilegeGroup(data.name);
	}

	async function privilegeGroupExists(name) {
		return Groups.isPrivilegeGroup(name) && await db.isSortedSetMember('groups:createtime', name);
	}

	async function checkGroupExistence(name) {
		const [exists, privGroupExists] = await Promise.all([
			meta.userOrGroupExists(name),
			privilegeGroupExists(name),
		]);
		if (exists || privGroupExists) {
			throw new Error('[[error:group-already-exists]]');
		}
	}

	function determineDisableJoinRequests(data) {
		if (data.name === 'administrators') {
			return 1;
		}
		return parseInt(data.disableJoinRequests, 10) === 1 ? 1 : 0;
	}

	function buildGroupData(data, timestamp, disableJoinRequests, disableLeave, isHidden, isSystem) {
		const memberCount = data.hasOwnProperty('ownerUid') ? 1 : 0;
		const isPrivate = data.hasOwnProperty('private') && data.private !== undefined ? parseInt(data.private, 10) === 1 : true;

		return {
			name: data.name,
			slug: slugify(data.name),
			createtime: timestamp,
			userTitle: data.userTitle || data.name,
			userTitleEnabled: parseInt(data.userTitleEnabled, 10) === 1 ? 1 : 0,
			description: data.description || '',
			memberCount: memberCount,
			hidden: isHidden ? 1 : 0,
			system: isSystem ? 1 : 0,
			private: isPrivate ? 1 : 0,
			disableJoinRequests: disableJoinRequests,
			disableLeave: disableLeave,
		};
	}

	async function saveGroupData(groupData, timestamp, ownerUid) {
		await db.sortedSetAdd('groups:createtime', groupData.createtime, groupData.name);
		await db.setObject(`group:${groupData.name}`, groupData);

		if (ownerUid) {
			await db.setAdd(`group:${groupData.name}:owners`, ownerUid);
			await db.sortedSetAdd(`group:${groupData.name}:members`, timestamp, ownerUid);
		}

		if (!groupData.hidden && !groupData.system) {
			await db.sortedSetAddBulk([
				['groups:visible:createtime', timestamp, groupData.name],
				['groups:visible:memberCount', groupData.memberCount, groupData.name],
				['groups:visible:name', 0, `${groupData.name.toLowerCase()}:${groupData.name}`],
			]);
		}

		if (!Groups.isPrivilegeGroup(groupData.name)) {
			await db.setObjectField('groupslug:groupname', groupData.slug, groupData.name);
		}
	}

	Groups.validateGroupName = function (name) {
		if (!name) {
			throw new Error('[[error:group-name-too-short]]');
		}

		if (typeof name !== 'string') {
			throw new Error('[[error:invalid-group-name]]');
		}

		if (!Groups.isPrivilegeGroup(name) && name.length > meta.config.maximumGroupNameLength) {
			throw new Error('[[error:group-name-too-long]]');
		}

		if (name === 'guests' || (!Groups.isPrivilegeGroup(name) && name.includes(':'))) {
			throw new Error('[[error:invalid-group-name]]');
		}

		if (name.includes('/') || !slugify(name)) {
			throw new Error('[[error:invalid-group-name]]');
		}
	};
};

