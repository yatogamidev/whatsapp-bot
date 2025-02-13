import { BotController } from "./controllers/Bot.Controller";
import { IMessageController } from "./controllers/Message.Controller";
import { MenuRepository } from "./repositories/MenuRespository";
import { UserRepository } from "./repositories/UserRepository";
import { Bot } from "./entities/Bot";
import { Menu } from "./entities/Menu";
import { isNumber } from "./helpers/MsgHelper";
import { MsgRequest } from "./protocols/MsgRequest";
// factories
import { OpenAttendanceClientFactory } from "./infra/socketio/factories/OpenAttendanceClientFactory";
import { SendMessageClientFactory } from "./infra/socketio/factories/SendMessageClientFactory";
import { IAttendanceRepository } from "./repositories/AttendanceRepository";
import { CreateUserFactory } from "./factories/CreateUserFactory";
import { UpdateUserRegisterFactory } from "./factories/UpdateUserRegisterFactory";
import { BotQuestionsUserFactory } from "./infra/factories/BotQuestionsUserFactory";
import { MenuFactory } from "./factories/MenuFactory"

export class App {

	constructor(
		private readonly robot: Bot,
		private readonly botController: BotController,
		private readonly messageController: IMessageController,
		private readonly menuRepository: MenuRepository,
		private readonly userRepository: UserRepository,
		private readonly attendanceRepository: IAttendanceRepository,
	) { }

	public async execute() {

		let userRegistrationSteps: any[] = []
		let postAttendance: string[] = []
		let registeredNow: string[] = []
		let askingForName: string[] = []

		this.botController.onMessage(async (msg: any) => {

			const menuController = MenuFactory(this.botController)
			const sendMessageController = SendMessageClientFactory(this.botController)
			const botQuestionsUserController = BotQuestionsUserFactory(this.botController)
			const updateUserRegisterController = UpdateUserRegisterFactory(this.botController)

			const chatId = msg.chatId
			const userExists = await this.userRepository.getOne(chatId, this.robot.id)

			if (!userExists) {
				const initialUser = {
					chat: chatId,
					branch_id: this.robot.id,
					menu_id: null,
					name: null,
				}
				await CreateUserFactory(this.botController)
					.execute(initialUser, msg)

				// registeredNow.push(chatId)
			}

			let user = await this.userRepository.getOne(chatId, this.robot.id)

			// const findRegisteredNow = registeredNow.find(number => number === chatId)
			const findAskingForName = askingForName.find(number => number === chatId)

			if (findAskingForName) {
				if (!isNumber(msg.text) && msg.text.length < 30) {
					await this.userRepository.update(chatId, this.robot.id, { name: msg.text })
					askingForName = askingForName.filter(number => number !== chatId)
				} else {
					return this.messageController.execute(chatId, { message: "Por favor, informe seu nome corretamente" })
				}
			}

			if (!user.name && !findAskingForName) {

				if (msg.name) {
					await this.userRepository.update(chatId, this.robot.id, { name: msg.name })
				} else {
					this.messageController.execute(chatId, { message: "Diga seu nome" })
					askingForName.push(chatId)
					return
				}
			}

			if (!userRegistrationSteps.find(userRegistration => userRegistration.id === user.id)) {

				const botRegistrationSteps: any[] = await botQuestionsUserController.execute(this.robot.id, user.id)

				if (botRegistrationSteps.length > 0) {
					userRegistrationSteps.push({ id: user.id, steps: [null, ...botRegistrationSteps] })
				}
			}

			const currentUserRegistrationStep = userRegistrationSteps.find(userRegistration => userRegistration.id === user.id)

			if (currentUserRegistrationStep && currentUserRegistrationStep.steps.length > 0) {
				const status = await updateUserRegisterController.execute(currentUserRegistrationStep.steps, msg, user)
				if (status === "finish") {
					userRegistrationSteps = userRegistrationSteps.filter((userRegistration: any) => userRegistration.id !== user.id)
				}
			}

			const attendance = await this.attendanceRepository.getAttendance(user.id)

			if (attendance || postAttendance.find((id: string) => id === user.id)) {
				return sendMessageController.execute({ ...msg, attendance })
			}

			let botMenu: any[] = []

			// @ts-ignore
			if (msg.text && ["voltar", "#", "0"].includes(msg.text.toLowerCase())) {

				await this.userRepository.saveCurrentMenu(user, null)
				const userMenu = await this.menuRepository.getByChildren(null, this.robot.id)

				//@modify
				botMenu = userMenu
				user = { ...user, menu_id: null }
			}

			//@modify
			botMenu = await this.menuRepository.getByChildren(user.menu_id, this.robot.id)

			let msgNext = false

			if (isNumber(msg.text) && msg.text != "0") {
				//console.log("Recebeu a mensagem ", msg.text, msg.chatId)
				await Promise.all(
					botMenu.map(async ({ id, order, is_attendment, department_id }: Menu) => {
						if (msg.text == order) {

							msgNext = true
							const menu = await this.menuRepository.getByChildren(id, this.robot.id)

							if (is_attendment === "yes" && department_id) {

								const menu = await this.menuRepository.getById(id, this.robot.id)
								const queue = postAttendance.find((id: string) => id === user.id)

								if (!queue) {
									postAttendance.push(id)
									await OpenAttendanceClientFactory(this.messageController).execute(menu, { ...msg, user }, department_id)
									setTimeout(() => {
										postAttendance = postAttendance.filter((id: string) => id !== user.id)
									}, 1000 * 10)
								}

							} else {
								await this.userRepository.saveCurrentMenu(user, id)
								return menuController.sendNextMenu({ ...user, chat: chatId }, id, menu, this.robot.id)
							}
						}
					})
				)

				if (msgNext === false) {
					await this.messageController.execute(chatId, { message: "Opção inválida" })
				}

			}
			else
				menuController.sendHomeOrSameMenu({ ...user, chat: chatId })
		})
	}
}