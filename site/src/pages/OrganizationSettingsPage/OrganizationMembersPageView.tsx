import PersonAdd from "@mui/icons-material/PersonAdd";
import LoadingButton from "@mui/lab/LoadingButton";
import { getErrorMessage } from "api/errors";
import type {
	Group,
	OrganizationMemberWithUserData,
	SlimRole,
	User,
} from "api/typesGenerated";
import { ErrorAlert } from "components/Alert/ErrorAlert";
import { Avatar } from "components/Avatar/Avatar";
import { AvatarData } from "components/Avatar/AvatarData";
import { Button } from "components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "components/DropdownMenu/DropdownMenu";
import { displayError, displaySuccess } from "components/GlobalSnackbar/utils";
import { SettingsHeader } from "components/SettingsHeader/SettingsHeader";
import { Stack } from "components/Stack/Stack";
import {
	Table,
	TableBody,
	TableCell,
	TableHeader,
	TableRow,
} from "components/Table/Table";
import { UserAutocomplete } from "components/UserAutocomplete/UserAutocomplete";
import { EllipsisVertical } from "lucide-react";
import { UserGroupsCell } from "pages/UsersPage/UsersTable/UserGroupsCell";
import { type FC, useState } from "react";
import { TableColumnHelpTooltip } from "./UserTable/TableColumnHelpTooltip";
import { UserRoleCell } from "./UserTable/UserRoleCell";

interface OrganizationMembersPageViewProps {
	allAvailableRoles: readonly SlimRole[] | undefined;
	canEditMembers: boolean;
	error: unknown;
	isAddingMember: boolean;
	isUpdatingMemberRoles: boolean;
	me: User;
	members: Array<OrganizationMemberTableEntry> | undefined;
	addMember: (user: User) => Promise<void>;
	removeMember: (member: OrganizationMemberWithUserData) => void;
	updateMemberRoles: (
		member: OrganizationMemberWithUserData,
		newRoles: string[],
	) => Promise<void>;
}

interface OrganizationMemberTableEntry extends OrganizationMemberWithUserData {
	groups: readonly Group[] | undefined;
}

export const OrganizationMembersPageView: FC<
	OrganizationMembersPageViewProps
> = ({
	allAvailableRoles,
	canEditMembers,
	error,
	isAddingMember,
	isUpdatingMemberRoles,
	me,
	members,
	addMember,
	removeMember,
	updateMemberRoles,
}) => {
	return (
		<div>
			<SettingsHeader title="Members" />
			<Stack>
				{Boolean(error) && <ErrorAlert error={error} />}

				{canEditMembers && (
					<AddOrganizationMember
						isLoading={isAddingMember}
						onSubmit={addMember}
					/>
				)}
				<Table>
					<TableHeader>
						<TableRow>
							<TableCell width="33%">User</TableCell>
							<TableCell width="33%">
								<Stack direction="row" spacing={1} alignItems="center">
									<span>Roles</span>
									<TableColumnHelpTooltip variant="roles" />
								</Stack>
							</TableCell>
							<TableCell width="33%">
								<Stack direction="row" spacing={1} alignItems="center">
									<span>Groups</span>
									<TableColumnHelpTooltip variant="groups" />
								</Stack>
							</TableCell>
							<TableCell width="1%" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{members?.map((member) => (
							<TableRow key={member.user_id} className="align-baseline">
								<TableCell>
									<AvatarData
										avatar={
											<Avatar
												fallback={member.username}
												src={member.avatar_url}
											/>
										}
										title={member.name || member.username}
										subtitle={member.email}
									/>
								</TableCell>
								<UserRoleCell
									inheritedRoles={member.global_roles}
									roles={member.roles}
									allAvailableRoles={allAvailableRoles}
									oidcRoleSyncEnabled={false}
									isLoading={isUpdatingMemberRoles}
									canEditUsers={canEditMembers}
									onEditRoles={async (roles) => {
										try {
											await updateMemberRoles(member, roles);
											displaySuccess("Roles updated successfully.");
										} catch (error) {
											displayError(
												getErrorMessage(error, "Failed to update roles."),
											);
										}
									}}
								/>
								<UserGroupsCell userGroups={member.groups} />
								<TableCell>
									{member.user_id !== me.id && canEditMembers && (
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button
													size="icon"
													variant="subtle"
													aria-label="Open menu"
												>
													<EllipsisVertical
														className="size-icon-md"
														aria-hidden="true"
													/>
													<span className="sr-only">Open menu</span>
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem
													className="text-content-destructive focus:text-content-destructive"
													onClick={() => removeMember(member)}
												>
													Remove
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</Stack>
		</div>
	);
};

interface AddOrganizationMemberProps {
	isLoading: boolean;
	onSubmit: (user: User) => Promise<void>;
}

const AddOrganizationMember: FC<AddOrganizationMemberProps> = ({
	isLoading,
	onSubmit,
}) => {
	const [selectedUser, setSelectedUser] = useState<User | null>(null);

	return (
		<form
			onSubmit={async (event) => {
				event.preventDefault();

				if (selectedUser) {
					try {
						await onSubmit(selectedUser);
						setSelectedUser(null);
					} catch (error) {
						displayError(getErrorMessage(error, "Failed to add member."));
					}
				}
			}}
		>
			<Stack direction="row" alignItems="center" spacing={1}>
				<UserAutocomplete
					className="w-[300px]"
					value={selectedUser}
					onChange={(newValue) => {
						setSelectedUser(newValue);
					}}
				/>

				<LoadingButton
					loadingPosition="start"
					disabled={!selectedUser}
					type="submit"
					startIcon={<PersonAdd />}
					loading={isLoading}
				>
					Add user
				</LoadingButton>
			</Stack>
		</form>
	);
};
